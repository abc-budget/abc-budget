Any bank statement always has an **amount**, but there may be variations in how that amount is shown. For example,
you may receive an account statement with two amounts, such as income and expenses, or one column with positive or
negative numbers. Also, the amount can be in the account currency or in the currency of the transaction.
### Configuration
#### Amount type
* **Income** - The amount reflects the income to the account. All numbers are displayed as positive.
    - ⚠️ **ABC Budget** currently does not include income
* **Expenses** - The amount represents the amount of money debited from the account. All numbers are shown as positive.
* **Mixed** - The amount column has both positive (income) and negative (expenses) numbers. This is the most common option.
* **Auto** - **ABC Budget** will try to detect the amount type automatically. If you use this option, please be careful as errors may occur.
#### Currency
> **Base Currency** - This is the currency you use in your everyday life and most financial transactions are made
> in this currency. You can change the base currency in the settings.
* **Auto-detect** - If the statement has a separate currency column, it will be used. Otherwise, the base currency will be used.
* **Use Base Currency** - The base currency will be used.
* **Select Currency** - You can select a currency from the list.
