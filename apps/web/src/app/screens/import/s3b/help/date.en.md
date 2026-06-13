The **date** in the bank statement indicates the day on which the financial transaction was made. This can be the date of a purchase,
transfer of funds, ATM withdrawal, etc.
The **date** on a bank statement is usually displayed in a **standard format** that includes the day, month, and year.
This typically looks like **MM/dd/yyyy** (e.g., 11/15/2023). Some banks may also indicate the time of the transaction,
which is added to the date in the format **MM/dd/yyyy HH:mm** (for example, 11/15/2023 10:30). It is important to note
that the date format may differ depending on the bank and region.
ℹ️ **Important Note**: **ABC Budget** relies on the date only when processing transactions, the time of the transaction
is not taken into account. It can be omitted from the settings.
### Configuration
#### Date format
In most cases, it is enough to select "**Automatic date format detection**". **ABC Budget** will select the most likely
date formats and try to apply them to the transactions. If you see any errors in the date detection, you can specify
the date format manually.
⚠️ **Important**: The date format is specified in [Unicode Technical Standard #3
5](https://www.unicode.org/reports/tr35/tr35-dates.html#Date_Field_Symbol_Table).
If the date uses fixed characters (i.e., they do not depend on the date and time), such as the prefix "Date :",
they must be specified in the date format by enclosing them in single brackets ('), except for punctuation.
For example, if the date looks like "Date : 11/15/2023", the date format will look like "'Date : 'MM/dd/yyyy".
| **Template** | **Description** | **Example**                      |
|--------------|-----------------|----------------------------------|
| y            | Year            | 2023                             |
| yy           |                 | 23                               |
| yyyy         |                 | 2023                             |
| M            | Month           | 1, 2, ... 12                     |
| MM           |                 | 01, 02, ... 12                   |
| MMM          |                 | Jan, Feb, ..., Dec               |
| MMMM         |                 | January, February, ..., December |
| d            | Day             | 1, 2, ... 31                     |
| dd           |                 | 01, 02, ... 31                   |
| E            | Day of week     | Mon, Tue, ..., Sun               |
| EEEE         |                 | Monday, Tuesday, ..., Sunday     |
