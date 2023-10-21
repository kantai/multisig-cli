# Multisig CLI tool

Command line utility written in NodeJS for creating and signing Stacks multisig transactions with a Ledger device

## How to Run

### CLI

```sh
npm start -- <subcommand> [args]
```

| Subcommand       | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `get_pub <path>` | Get public key from Ledger                                     |
| `make_multi`     | Make multisig address from pubkeys                             |
| `create_tx`      | Create unsigned multisig transaction                           |
| `sign`           | Sign multisig transaction with Ledger                          |
| `decode`         | Decode and print Stacks base64-encoded transaction             |
| `broadcast`      | Broadcast a transaction to the network                         |

| Flags            | Subcommands                       | Description                                           |
| ---------------- | ----------------------------------|-------------------------------------------------------|
| `--file <path>`  | `create_tx`, `sign`, `broadcast`  | Allow bulk operations by reading JSON array from file |

### Workflow

While using this tool, inputs/outputs will be in base64-encoded JSON.
You will need to copy/paste this between steps to manage application state.

The general work flow should go something like this:

#### Recieving funds

1. Get any Ledger public keys needed
   ```sh
   npm start -- get_pub <path>
   ```

2. Create a multisig address from pubkeys
   ```sh
   npm start -- make_multi
   ```

3. Use any wallet to send funds to the address

#### Sending funds

You will need the multisig address and pubkeys that were used in the previous section

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