# validatools

A collection of tools/scripts for Solana validator operators

## Available Scripts

### TypeScript

#### `ts-node ts/monthly-profitability/index.ts`

A script to track monthly validator profitability by calculating revenue from vote account rewards and Jito MEV tips compared against monthly expenses.

~Environment Variables~

The following environment variables are required:

- `VOTE_ACCOUNT` - Public key of your validator's vote account
- `IDENTITY` - Public key of your validator's identity account
- `MONTHLY_EXPENSES` - Your monthly validator expenses in USD
- `MONTHLY_BILLING_DAY` - Day of the month (1-31) to start the billing cycle (optional, defaults to 1)

~Example Output~

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
