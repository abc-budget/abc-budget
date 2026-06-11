import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { monthKey, checkAndIncrementMonthlyCap } from "./budget.js";
import { RateLimiter } from "./rate-limit.js";
import { checkOrigin } from "./origin.js";
import { handleRatesRequest, type HandlerDeps } from "./handler.js";

const firebaseDBName = "exchange-rates-eur3";
if (getApps().length === 0) initializeApp();
const db = getFirestore(firebaseDBName);

// Adaptation (2): monthly OER-fetch budget cap
const OER_MONTHLY_CAP = 1000;

const openExchangeRatesAppId = defineSecret("OPENEXCHANGERATES_APP_ID");

/**
 * Checks Firestore for data corresponding to the given date.
 *
 * @param {string} date - The date of the document to check in Firestore.
 * @return {Promise<Record<string, number> | null>} - Returns a promise that resolves to the document data
 * if it exists, otherwise null.
 */
async function checkDataAtFirestore(date: string): Promise<Record<string, number> | null> {
    logger.debug("Checking Firestore for data at date", date);
    const docRef = db.collection("usd").doc(date);
    try {
        const doc = await docRef.get();
        if (doc.exists) {
            const rates = doc.data() as Record<string, number>;
            logger.debug("Found exchange rates for", Object.keys(rates).length, "currencies");
            return rates;
        } else {
            logger.debug("No such exchange rates at Firestore for date", date);
            return null;
        }
    } catch (error) {
        logger.error("Error getting document:", error);
        return null;
    }
}

/**
 * Saves the given data to Firestore under the specified date.
 *
 * @param {string} date - The date representing the document ID in the Firestore collection.
 * @param {Record<string, number>} rates - An object representing the rates data to be saved.
 * @return {Promise<void>} A promise that resolves when the data has been successfully saved.
 */
async function saveDataToFirestore(date: string, rates: Record<string, number>): Promise<void> {
    logger.info("Saving data to Firestore at date", date);
    const docRef = db.collection("usd").doc(date);
    try {
        await docRef.set(rates);
        logger.debug("Saved exchange rates for", Object.keys(rates).length, "currencies");
    } catch (error) {
        logger.error("Error adding document: ", error);
    }
}

type GetRatesResponse = {
    disclaimer: string;
    license: string;
    base: string;
    rates: Record<string, number>;
}

/**
 * Fetches exchange rates from the Open Exchange Rates API for a given date.
 * @param {string} date - The date for which to fetch the exchange rates in YYYY-MM-DD format.
 * @return {Promise<Record<string, number>>} A promise that resolves to the rates map for the specified date.
 */
async function fetchFromOpenExchangeRates(date: string): Promise<Record<string, number>> {
    logger.info("Fetching data from Open Exchange Rates at date", date);
    const appId = openExchangeRatesAppId.value();
    const url = `https://openexchangerates.org/api/historical/${date}.json?app_id=${appId}`;
    let response: Response;
    try {
        response = await fetch(url);
    } catch (error) {
        logger.error("Error fetching data from Open Exchange Rates", error);
        throw new Error("Failed to fetch data from Open Exchange Rates");
    }
    if (!response.ok) {
        logger.error("Failed to fetch data from Open Exchange Rates. Response status", response.status);
        throw new Error("Failed to fetch data from Open Exchange Rates");
    }
    logger.debug("Data fetched from Open Exchange Rates");
    try {
        const json = await response.json() as GetRatesResponse;
        return json.rates;
    } catch (e) {
        logger.error("Error parsing JSON response from Open Exchange Rates", e);
        throw new Error("Failed to parse JSON response from Open Exchange Rates");
    }
}

// Per-instance token bucket: 10 req/min/IP, burst of 10.
// Cloud Functions maxInstances: 2 → effective global limit is up to 20 req/min/IP (best-effort).
// req.ip is set by Cloud Functions from the X-Forwarded-For header (first untrusted hop).
const RATE_LIMIT_CAPACITY = 10;
const RATE_LIMIT_REFILL_PER_MS = RATE_LIMIT_CAPACITY / 60_000; // 10 per minute
const rateLimiter = new RateLimiter(RATE_LIMIT_CAPACITY, RATE_LIMIT_REFILL_PER_MS);

// noinspection JSUnusedGlobalSymbols
export const getUSDRates = onRequest(
    {
        secrets: [openExchangeRatesAppId],
        region: "europe-west1",
        maxInstances: 2,
    },
    async (req, res) => {
        const deps: HandlerDeps = {
            now: () => new Date(),
            checkOrigin,
            rateLimiterTake: (key, now) => rateLimiter.take(key, now),
            checkFirestore: checkDataAtFirestore,
            runBudgetTransaction: async (now: Date) => {
                const budgetDocRef = db.collection("meta").doc("oer-budget");
                let allowed = false;
                await db.runTransaction(async (tx) => {
                    const snap = await tx.get(budgetDocRef);
                    const docData = (snap.data() ?? {}) as Record<string, number>;
                    const key = monthKey(now);
                    const result = checkAndIncrementMonthlyCap(docData, key, OER_MONTHLY_CAP);
                    if (!result.allowed) {
                        return;
                    }
                    tx.set(budgetDocRef, result.next);
                    allowed = true;
                });
                return allowed;
            },
            fetchOER: fetchFromOpenExchangeRates,
            saveToFirestore: saveDataToFirestore,
        };

        await handleRatesRequest(req, res, deps);
    }
);
