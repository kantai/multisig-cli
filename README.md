# Multisig CLI tool

Command line utility written in NodeJS for creating and signing Stacks multisig transactions with a Ledger device

## How to Run

### CLI

```sh
npm start -- <subcommand> [args]
```

| Subcommand       | Description                                                    |
| ---------------- | -------------------------------------------------------------- |
| `decode`         | Decode and print Stacks base64-encoded Transaction             |
| `get_pub`        | Get public key from Ledger                                     |
| `make_multi`     | Make multisig address from pubkeys                             |
| `create_tx`      | Create unsigned multisig transaction                           |
| `sign`           | Sign multisig transaction with Ledger                          |