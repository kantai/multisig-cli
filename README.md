# Multisig CLI tool

Command line utility written in NodeJS for creating and signing Stacks multisig transactions with a Ledger device

## Dependencies

You will need to have `nodejs` and `npm` installed.
After cloning the repository, go to the project root and run:

```sh
npm install
```

## How to Run

### CLI

```sh
npm start -- <subcommand> [args]
```

| Subcommand       | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `get_pub <path>` | Get public key from Ledger                                     |
| `make_multi`     | Make multisig address from pubkeys                             |
| `check_multi`    | Check multisig addresses derived from pubkeys                  |
| `create_tx`      | Create unsigned multisig transaction                           |
| `sign`           | Sign multisig transaction with Ledger                          |
| `decode`         | Decode and print Stacks base64-encoded transaction             |
| `broadcast`      | Broadcast a transaction to the network                         |

| Flags                 | Subcommands                       | Description                                           |
| --------------------- | ----------------------------------|-------------------------------------------------------|
| `--json-inputs <path>`| `create_tx`                       | Read transaction inputs from JSON file                |
| `--csv-inputs <path>` | `create_tx`                       | Read transaction inputs from a CSV file               |
| `--json-txs <path>`   | `sign`, `broadcast`               | Allow bulk operations by reading JSON array from file |
| `--csv-keys <path>`   | `sign`                            | Sign using pubkeys/paths from a CSV file              |
| `--out-file <path>`   | `create_tx`, `sign`, `broadcast`  | Output JSON directly to file                          |

## Examples

### Recieving Funds

1. Get any Ledger public keys needed
   ```sh
   npm start -- get_pub <path>
   ```

2. Create a multisig address from pubkeys
   ```sh
   npm start -- make_multi
   ```

3. Use any wallet to send funds to the address

### Single Transaction Using User Input

While using this tool, inputs/outputs will be in base64-encoded JSON.
You will need to copy/paste this between steps to manage application state.

1. Create a transaction
   ```sh
   npm start -- create_tx
   ```

2. For each required signature, sign with Ledger
   ```sh
   npm start -- sign
   ```

3. **[Optional]** Print transaction as JSON to check
   ```sh
   npm start -- decode
   ```

3. Broadcast transaction
   ```sh
   npm start -- broadcast
   ```

### Bulk Transactions

1. Create the transactions from a CSV file and save outputs to file
   ```sh
   npm start -- create_tx --csv-inputs $CSV_INPUTS_FILE --out-file transactions.json
   ```

2. Sign the transactions and save outputs to file
   ```sh
   npm start -- sign --json-txs transactions.json --csv-keys $CSV_KEYS_FILE --out-file signed_transactions.json
   ```

3. Broadcast transactions
   ```sh
   npm start -- broadcast --json-txs signed_transactions.json --out-file broadcast_results.json
   ```

## Using Docker

You will need Docker and `just` (can be installed by `cargo install just`)

### Building the Image

```sh
just build
```

### Running the Image

Run the same way you would run normally, but replace the `npm start --` prefix with:

```sh
just run [args...]
```