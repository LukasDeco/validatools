# validatools

A collection of tools for validating data.

## Available Scripts

### `ts-node src/index.ts`

Runs the main validation script that checks for duplicate records in a CSV file.

## Environment Variables

The following environment variables are required:

- `CSV_FILE_PATH` - Path to the CSV file to validate
- `UNIQUE_COLUMNS` - Comma-separated list of column names that should be unique in combination

## Example Output

When running the script, you'll see output similar to:

```
Period: 2025-04-19 to 2025-05-03
Total SOL gained: 1.88 SOL ($279.63)
Vote account rewards: 0.99 SOL ($147.39)
Jito MEV tips: 0.89 SOL ($132.24)
Current SOL price: $148.73

Since 2025-04-19:
- Revenue: $279.63
- Expenses: $1400.00
- Coverage so far: 19.97%
- Month elapsed: 47.96%
- ⚠️ Behind pace (projected coverage: 41.6%)
- 🟡 You've covered 19.97% of your expenses.
```
