import TransportNodeHid from "@ledgerhq/hw-transport-node-hid";
import StxApp from "@zondax/ledger-blockstack";
import readline from "readline";

import * as StxTx from "@stacks/transactions";
import * as lib from "./lib";

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

async function getTransport() {
  //return await SpecTransport.open({ apduPort: 40000 });
  return await TransportNodeHid.create();
}

//=================
// Subcommands
//=================

async function subcommand_get_pub(args: string[], transport: object) {
  const app = new StxApp(transport);
  const path = args[0];
  if (!path) {
    throw new Error("Must supply path as second argument");
  }
  const pubkey = await lib.getPubKey(app, path);
  console.log(`Pub: ${pubkey} @ ${path}`);
}

async function subcommand_decode() {
  // Decode and print transaction
  const inputPayload = await readInput("Transaction input (base64)");
  const tx = lib.txDecode(inputPayload);
  //const tx = await lib.generateMultiSignedTx();
  console.dir(tx, {depth: null, colors: true})
}

async function subcommand_make_multi(args: string[], transport: object) {
  const app = new StxApp(transport);
  const addr = await lib.generateMultiSigAddr(app);
  console.log(`Addr: ${addr}`);
}

async function subcommand_create_tx(args: string[]) {
  if (args[0] === '--file') {
    const txs = await lib.makeTxsFromFile(args[1]);
    const txs_encoded = txs.map(tx => lib.txEncode(tx));
    console.log(`Unsigned multisig transactions`);
    console.log(`------------------------------`);
    console.log(txs_encoded);
  } else {
    const sender = await readInput("From Address (C32)");
    const signers = (await readInput("From public keys (comma separate)")).split(',').map(x => x.trim());
    const reqSignatures = parseInt(await readInput("Required signers (number)"));
    const recipient = await readInput("To Address (C32)");
    const amount = await readInput("microSTX to send");
    const fee = await readInput("microSTX fee");
    const nonce = await readInput("Nonce (optional)");
    const network = await readInput("Network (optional) [testnet/mainnet]");

    const txInput: lib.MultisigTxInput = {
        sender, recipient, fee, amount,
        signers, reqSignatures, nonce, network,
    };

    const tx = await lib.makeStxTokenTransferFrom(txInput);
    const encoded = lib.txEncode(tx);
    console.log(`Unsigned multisig transaction`);
    console.log(`-----------------------------`);
    console.log(encoded);
  }
}

async function subcommand_sign(args: string[], transport: object) {
  const app = new StxApp(transport);
  const inputPayload = await readInput("Unsigned or partially signed transaction input (base64)");
  const hdPath = await readInput("Signer path (HD derivation path)");

  const tx = lib.txDecode(inputPayload);
  console.log("    *** Please check and approve signing on Ledger ***");
  const signed_tx = await lib.ledgerSignMultisigTx(app, hdPath, tx);
  const info = lib.getAuthFieldInfo(tx);
  const encoded = lib.txEncode(signed_tx);
  console.log(`Signed payload (${info.signatures}/${info.signaturesRequired} required signatures): ${encoded}`)
}

async function subcommand_broadcast() {
  const inputPayload = await readInput("Signed transaction input (base64)");
  const tx = lib.txDecode(inputPayload);
  const res = await StxTx.broadcastTransaction(tx);

  console.dir(res, {depth: null, colors: true});
}

function subcommand_help() {
  // TODO
  console.log("Invalid subcommand")
}

//=================
// main()
//=================

async function main(args: string[]) {
  let transport = null;
  const subcommand = args.shift();

  switch (subcommand) {
    case 'get_pub':
      transport = await getTransport();
      await subcommand_get_pub(args, transport);
      break;
    case 'decode':
      await subcommand_decode();
      break;
    case 'make_multi':
      transport = await getTransport();
      await subcommand_make_multi(args, transport);
      break;
    case 'create_tx':
      await subcommand_create_tx(args);
      break;
    case 'sign':
      transport = await getTransport();
      await subcommand_sign(args, transport);
      break;
    case 'broadcast':
      await subcommand_broadcast();
      break;
    case 'help':
    case '-h':
    case '--help':
    default:
      subcommand_help();
      break;
  }

  await transport?.close();
}

main(process.argv.slice(2))
