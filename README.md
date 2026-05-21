# validatools

A collection of tools/scripts for Solana validator operators

## Available Scripts

### TypeScript

#### `ts-node ts/src/monthly-profitability/index.ts`

A script to track monthly validator profitability by calculating revenue from vote account rewards and Jito MEV tips compared against monthly expenses.

**Environment Variables**

The following environment variables are required:

- `VOTE_ACCOUNT` - Public key of your validator's vote account
- `IDENTITY` - Public key of your validator's identity account
- `MONTHLY_EXPENSES` - Your monthly validator expenses in USD
- `MONTHLY_BILLING_DAY` - Day of the month (1-31) to start the billing cycle (optional, defaults to 1)

**Example Output**

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

### Central runner (cron scheduler)

Use the centralized runner to enable multiple tools via one `config.yaml`:

```
node ts/dist/src/index.js --config ./ts/src/config.yaml
```

**Telegram** — With `TELEGRAM_ENABLED`="true", cron tools send logs to Telegram. The SFDP / validator version checker sends to `TELEGRAM_ALERT_CHAT_ID` when set, falling back to `TELEGRAM_CHAT_ID`; other cron tools send to `TELEGRAM_CHAT_ID`. To mirror **inbound** messages (e.g. agave-watchtower posting “delinquent” into the main group) to a **critical** group, run the separate **telegram-inbound-relay** process (see below); it is not part of `config.yaml` or the cron runner.

General config layout (each tool can be enabled and scheduled):

```yaml
monthlyProfitability:
  enabled: false
  schedule: '0 0 * * *'
  config: {}

sfdpCompliance:
  enabled: true
  schedule: '*/30 * * * *'
  config:
    mainnetIdentity: '...'
    testnetIdentity: '...'
    onlyLogIssues: false

doublezeroDeposit:
  enabled: true
  schedule: '*/15 * * * *'
  config:
    mainnetIdentity: '...'
    thresholdSol: 2.0
    programId: 'dzrevZC94tBLwuHw1dyynZxaXTWyp7yocsinyEVPtt4'
```

### Telegram inbound relay (watchtower → critical chat)

Long-polls the Bot API and forwards messages that contain `delinquent` (case-insensitive) from your **main** Telegram chat to a **second** chat. Use this when alerts come from another bot (e.g. agave-watchtower) into the main group, not from validatools logs.

Run as its **own** long-lived process (systemd, screen, K8s sidecar, etc.) **alongside** the central runner:

```
node ts/dist/src/telegram-inbound-relay/index.js
```

Or with `ts-node`:

```
npx ts-node ts/src/telegram-inbound-relay/index.ts
```

**Bot privacy:** In [@BotFather](https://t.me/BotFather), turn **privacy mode off** for this bot (`/setprivacy` → Disable). Otherwise the bot will not receive normal group messages in `getUpdates`, only commands and mentions.

**Environment variables (all required for the relay):**

| Variable                 | Purpose                                                                |
| ------------------------ | ---------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`     | Same bot added to both chats                                           |
| `TELEGRAM_CHAT_ID`       | Main group/supergroup to **watch** (only messages here are considered) |
| `TELEGRAM_ALERT_CHAT_ID` | Critical group/supergroup to **receive** forwards                      |

Optional: `TELEGRAM_ALERT_COOLDOWN_MS` — minimum milliseconds between forwards (default `600000`, 10 minutes).

### DoubleZero deposit monitor

Monitor a validator's DoubleZero deposit PDA balance and alert if it falls below a threshold.

Run via the central runner with a config file (recommended):

```
node ts/dist/src/index.js --config ./ts/src/config.yaml
```

Add this section to your config:

```yaml
doublezeroDeposit:
  enabled: true
  schedule: '*/15 * * * *'
  config:
    mainnetIdentity: '<VALIDATOR_ID_PUBKEY>'
    thresholdSol: 2.0
    programId: 'dzrevZC94tBLwuHw1dyynZxaXTWyp7yocsinyEVPtt4'
```

CLI overrides (optional):

```
--dz-node-id <PUBKEY>
--dz-threshold-sol <NUMBER>
--dz-program-id <PROGRAM_PUBKEY>
```

Environment variables:

- `MAINNET_RPC_URL` or `RPC_URL` (optional; defaults to mainnet public RPC)
- `TELEGRAM_ENABLED`="true" to send alerts
- `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` when Telegram is enabled

### SFDP compliance checker

Checks your validator version against required network versions (mainnet and testnet). Runs via the central runner.

Config snippet:

```yaml
sfdpCompliance:
  enabled: true
  schedule: '*/30 * * * *'
  config:
    mainnetIdentity: '<MAINNET_IDENTITY_PUBKEY>'
    testnetIdentity: '<TESTNET_IDENTITY_PUBKEY>'
    onlyLogIssues: false
```

CLI overrides (optional):

```
--sfdp-mainnet-identity <PUBKEY>
--sfdp-testnet-identity <PUBKEY>
--sfdp-only-log-issues
--sfdp-mainnet-version <X.Y.Z>
--sfdp-testnet-version <X.Y.Z>
```

Environment variables:

- `MAINNET_RPC_URL` and `TESTNET_RPC_URL` (optional)
- `TELEGRAM_ENABLED`="true", plus `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ALERT_CHAT_ID` for alerts (`TELEGRAM_CHAT_ID` is used as a fallback)

### Slot latency benchmark (standalone)

Measures average slot interval locally vs a remote RPC to gauge a hot spare’s catch-up.

Run (requires a TS runner or compiled JS):

```
ts-node ts/src/slot-latency-benchmark/index.ts
```

Environment variables:

- `SAMPLE_COUNT` (default 60)
- `SOLANA_CLUSTER` (mainnet-beta|testnet|devnet; default mainnet-beta)
- `RPC_URL` (optional; overrides cluster default)
