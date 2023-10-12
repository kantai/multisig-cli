
import SpecTransport from "@ledgerhq/hw-transport-node-speculos";
import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";

import StxApp from "@zondax/ledger-blockstack";
import { LedgerError } from "@zondax/ledger-blockstack";

import * as btc from "bitcoinjs-lib";
import * as C32 from "c32check";
import { AddressVersion, TransactionAuthField, UnsignedMultiSigTokenTransferOptions } from "@stacks/transactions";
import readline from "readline";

import BigNum from "bn.js";

import * as StxTx from "@stacks/transactions";

import { MultisigData, makeMultiSigAddr, makeStxTokenTransferFrom, base64Deserialize, base64Serialize, ledgerSignMultisigTx, getPubKey, getPubKeyMultisigStandardIndex, getPubKeySingleSigStandardIndex, getAuthFieldInfo, generateMultiSigAddr } from "./lib";

async function readInput(query: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  const answer: string = await new Promise(resolve => {
    rl.question(`${query}? `, answer => resolve(answer))
  });

  rl.close();

  return answer.trim();
}

async function main(args: string[]) {
  //let transport = await SpecTransport.open({ apduPort: 40000 });
  let transport = await TransportNodeHid.create();

  if (args[0] == "get_pub") {
    let app = new StxApp(transport);
    const path = args[1];
    if (!path) {
      throw new Error("Must supply path as second argument");
    }
    let pubkey = await getPubKey(app, path);
    console.log(`Pub: ${pubkey} @  ${path}`);
  } else if (args[0] == "decode") {
    // Decode and print transaction
    const inputPayload = await readInput("Transaction input (base64)");
    const tx = base64Deserialize(inputPayload) as StxTx.StacksTransaction;
    console.log(tx)
  } else if (args[0] == "make_multi") {
    let app = new StxApp(transport);
    let addr = await generateMultiSigAddr(app);
    console.log(`Addr: ${addr}`);
  } else if (args[0] == "create_tx") {
    const fromAddr = (await readInput("From Address (C32)"));
    const fromPKsHex = (await readInput("From public keys (comma separate)")).split(',').map(x => x.trim()).sort();
    const requiredSigners = parseInt(await readInput("Required signers (number)"));
    const toAddress = await readInput("To Address (C32)");
    const toSend = await readInput("microSTX to send");
    const fee = await readInput("microSTX fee");

    const spendingFields = fromPKsHex.map(x => ({ publicKey: x }));
    const generatedMultiSigAddress = makeMultiSigAddr(fromPKsHex, requiredSigners);

    if (generatedMultiSigAddress !== fromAddr) {
        const message = `Public keys, required signers do not match expected address: expected=${fromAddr}, generated=${generatedMultiSigAddress}`;
        throw new Error(message);
    }

    // Contains tx + metadata
    const multisigData: MultisigData = {
        tx: {
            fee,
            amount: toSend,
            numSignatures: requiredSigners,
            recipient: toAddress,
        },
        spendingFields,
        sigHashes: [],
    };

    const tx = await makeStxTokenTransferFrom(multisigData);

    let encoded = base64Serialize(tx);
    console.log(`Unsigned multisig transaction: ${encoded}`)
  } else if (args[0] == "sign") {
    const app = new StxApp(transport);
    const inputPayload = await readInput("Unsigned or partially signed transaction input (base64)");
    const hdPath = await readInput("Signer path (HD derivation path)");

    const tx = base64Deserialize(inputPayload) as StxTx.StacksTransaction;
    console.log("    *** Please check and approve signing on Ledger ***");
    const signed_tx = await ledgerSignMultisigTx(app, hdPath, tx);
    const info = getAuthFieldInfo(tx);
    const encoded = base64Serialize(signed_tx);
    console.log(`Signed payload (${info.signatures}/${info.signaturesRequired} required signatures): ${encoded}`)
  }

  await transport.close();
}

var inputs = process.argv.slice(2);

main(inputs)
  .then(x => { console.log("") })
