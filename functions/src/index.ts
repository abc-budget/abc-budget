import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { HttpsError, onCall } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import * as logger from "firebase-functions/logger";
import { validateDate, isDateInRange } from "./validate.js";
import { monthKey, checkAndIncrementMonthlyCap } from "./budget.js";

const firebaseDBName = "exchange-rates-eur3";
if (getApps().length === 0) initializeApp();
const db = getFirestore(firebaseDBName);

// Adaptation (2): monthly OER-fetch budget cap
const OER_MONTHLY_CAP = 1000;

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

const openExchangeRatesAppId = defineSecret("OPENEXCHANGERATES_APP_ID");

/**
 * Fetches exchange rates from the Open Exchange Rates API for a given date.
 * @param {string} date - The date for which to fetch the exchange rates in YYYY-MM-DD format.
 * @return {Promise<GetRatesResponse>} A promise that resolves to the exchange rates data for the specified date.
 */
async function fetchFromOpenExchangeRates(date: string): Promise<GetRatesResponse> {
    logger.info("Fetching data from Open Exchange Rates at date", date);
    const appId = openExchangeRatesAppId.value();
    const url = `https://openexchangerates.org/api/historical/${date}.json?app_id=${appId}`;
    let response: Response;
    try {
        response = await fetch(url);
    } catch (error) {
        logger.error("Error fetching data from Open Exchange Rates", error);
        throw new HttpsError("internal", "Failed to fetch data from Open Exchange Rates");
    }
    if (!response.ok) {
        logger.error("Failed to fetch data from Open Exchange Rates. Response status", response.status);
        throw new HttpsError("internal", "Failed to fetch data from Open Exchange Rates");
    }
    logger.debug("Data fetched from Open Exchange Rates");
    try {
        return await response.json();
    } catch (e) {
        logger.error("Error parsing JSON response from Open Exchange Rates", e);
        throw new HttpsError("internal", "Failed to parse JSON response from Open Exchange Rates");
    }
}

type GetRatesResponse = {
    disclaimer: string;
    license: string;
    base: string;
    rates: Record<string, number>;
}

// noinspection JSUnusedGlobalSymbols
export const getUSDRates = onCall(
    {
        secrets: [openExchangeRatesAppId],
        region: "europe-west1",
        // Adaptation (1): no Firebase Auth in Core — App Check is the attestation gate (HC-1).
        enforceAppCheck: true,
        // Adaptation (4): updated CORS allowlist for abc-budget-2d379 project.
        cors: [
            /https:\/\/abc-budget-2d379\.web\.app/,
            /https:\/\/abc-budget-2d379\.firebaseapp\.com/,
            /http:\/\/localhost:5173/,
            /http:\/\/localhost:4173/,
        ],
    },
    async (request) => {
        // Adaptation (1): request.auth block removed; enforceAppCheck: true handles attestation.
        const date = request.data.date;
        if (!date) {
            logger.error("Missing date parameter in getUSDRates");
            throw new HttpsError("invalid-argument", "The date parameter is required");
        }
        if (!validateDate(date)) {
            logger.error("Invalid date parameter in getUSDRates");
            throw new HttpsError("invalid-argument", "The date parameter must be in the format YYYY-MM-DD");
        }
        // Adaptation (3): date range check — reject future dates and pre-1999 dates.
        const now = new Date();
        if (!isDateInRange(date, now)) {
            logger.error("Date out of allowed range in getUSDRates", { date });
            throw new HttpsError("invalid-argument", "The date parameter is out of the allowed range (1999-01-01 to today)");
        }
        logger.info("Returning USD rates for date", date);

        const firestoreData = await checkDataAtFirestore(date);
        if (firestoreData) {
            // Cache hit: do NOT touch the OER budget counter.
            logger.info("OK");
            return firestoreData;
        }

        // Adaptation (2): check and increment monthly OER budget before hitting the API.
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
        if (!allowed) {
            logger.error("Monthly OER budget exhausted");
            throw new HttpsError("resource-exhausted", "Monthly OER budget exhausted");
        }

        const openExchangeRatesData = await fetchFromOpenExchangeRates(date);
        await saveDataToFirestore(date, openExchangeRatesData.rates);
        logger.info("OK");
        return openExchangeRatesData.rates;
    }
);
