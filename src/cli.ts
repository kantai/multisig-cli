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
    rl.question(`${query}? `, answer => resolve(answer));
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

export async function subcommand_get_pub(args: string[], transport: object): Promise<string> {
  const app = new StxApp(transport);
  const path = args[0];
  if (!path) {
    throw new Error("Must supply path as second argument");
  }
  const pubkey = await lib.getPubKey(app, path);
  console.log(`Pub: ${pubkey} @ ${path}`);

  // return value for unit testing
  return pubkey;
}

export async function subcommand_decode(): Promise<StxTx.StacksTransaction> {
  // Decode and print transaction
  const inputPayload = await readInput("Transaction input (base64)");
  const tx = lib.txDecode(inputPayload);
  //const tx = await lib.generateMultiSignedTx();
  console.dir(tx, {depth: null, colors: true});

  // return value for unit testing
  return tx;
}

export async function subcommand_make_multi(args: string[], transport: object): Promise<string> {
  const app = new StxApp(transport);
  const addr = await lib.generateMultiSigAddr(app);
  console.log(`Addr: ${addr}`);

  // return value for unit testing
  return addr;
}

export async function subcommand_create_tx(args: string[]): Promise<string[]> {
  let inputs: lib.MultisigTxInput[];

  // Get inputs
  if (args[0] === '--file') {
    inputs = await lib.makeTxInputsFromFile(args[1]);
  } else {
    const sender = await readInput("From Address (C32)");
    const publicKeys = (await readInput("From public keys (comma separate)")).split(',').map(x => x.trim());
    const numSignatures = parseInt(await readInput("Required signers (number)"));
    const recipient = await readInput("To Address (C32)");
    const amount = await readInput("microSTX to send");
    const fee = await readInput("microSTX fee");
    const nonce = await readInput("Nonce (optional)");
    const network = await readInput("Network (optional) [testnet/mainnet]");

    inputs = [
      { sender, recipient, fee, amount, publicKeys, numSignatures, nonce, network }
    ];
  }

  // Generate transactions
  const txs = await lib.makeStxTokenTransfers(inputs);
  const txsEncoded = txs.map(lib.txEncode);

  // Output transactions
  console.log(`Unsigned multisig transactions`);
  console.log(`------------------------------`);
  console.dir(txsEncoded, {depth: null, colors: true});

  // return value for unit testing
  return txsEncoded;
}

export async function subcommand_sign(args: string[], transport: object): Promise<string[]> {
  const app = new StxApp(transport);
  const hdPath = await readInput("Signer path (HD derivation path)");

  let txsEncodedIn: string[];

  // Get transactions
  if (args[0] === '--file') {
    txsEncodedIn = await lib.encodedTxsFromFile(args[1]);
  } else {
    const txEncoded = await readInput("Unsigned or partially signed transaction input (base64)");
    txsEncodedIn = [ txEncoded ];
  }

  // Decode transactions
  const txsIn = txsEncodedIn.map(lib.txDecode);
  const txsOut: StxTx.StacksTransaction[] = [];

  // Sign transactions
  for (const tx of txsIn) {
    console.log("    *** Please check and approve signing on Ledger ***");
    const txSigned = await lib.ledgerSignMultisigTx(app, hdPath, tx);
    txsOut.push(txSigned);
  }

  // Encode and output transactions
  if (txsOut.length === 1) {
    const info = lib.getAuthFieldInfo(txsOut[0]);
    console.log(`Signed payload (${info.signatures}/${info.signaturesRequired} required signatures)`);
    console.log(`------------------------------`);
  } else {
    console.log(`Signed payloads`);
    console.log(`------------------------------`);
  }

  const txsEncodedOut = txsOut.map(lib.txEncode);
  console.dir(txsEncodedOut, {depth: null, colors: true});

  // return value for unit testing
  return txsEncodedOut;
}

export async function subcommand_broadcast(args: string[]): Promise<StxTx.TxBroadcastResult[]> {
  let txsEncoded: string[];

  // Get transactions
  if (args[0] === '--file') {
    txsEncoded = await lib.encodedTxsFromFile(args[1]);
  } else {
    const txEncoded = await readInput("Signed transaction input (base64)");
    txsEncoded = [ txEncoded ];
  }

  // Decode transactions
  const txs = txsEncoded.map(lib.txDecode);

  // Broadcast transactions. Use async so it happens in parallel
  const results = await Promise.all(
    txs.map(async (tx) => await StxTx.broadcastTransaction(tx))
  );

  // Output results
  console.dir(results, {depth: null, colors: true});

  // return value for unit testing
  return results;
}

export function subcommand_help() {
  // TODO
  console.log("Invalid subcommand");
}

//=================
// main()
//=================

export async function main(args: string[]) {
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
    await subcommand_broadcast(args);
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