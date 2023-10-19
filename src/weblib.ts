import 'bootstrap/dist/css/bootstrap.min.css';
export * from './lib';

import { MultisigTxInput, getAuthFieldInfo, txDecode, txEncode, makeMultiSigAddr, ledgerSignMultisigTx, makeStxTokenTransferFrom } from './lib';
import StxApp from "@zondax/ledger-blockstack";
import LedgerTransportWeb from '@ledgerhq/hw-transport-webhid';
import BlockstackApp from '@zondax/ledger-blockstack';

import * as StxTx from "@stacks/transactions";

function getInputElement(id: string): string {
    return (document.getElementById(id)! as HTMLInputElement).value.trim()
}

export function displayMessage(name: string, message: string, title: string) {
    const container = document.getElementById(name)!;
    container.classList.remove('invisible');
    const displayArea = document.getElementById(`${name}-message`)!;
    displayArea.innerHTML = message
  
    if (title) {
      const titleArea = document.getElementById(`${name}-title`)!;
      titleArea.innerHTML = title
    }
}

let LEDGER_APP_CONN: undefined | BlockstackApp = undefined;

export async function connectLedgerApp() {
    if (!LEDGER_APP_CONN) {
        const transport = await LedgerTransportWeb.create();
        const app = new StxApp(transport);
        LEDGER_APP_CONN = app;
        return app;
    } else {
        return LEDGER_APP_CONN;
    }
}

export async function sign() {
    try {
        const app = await connectLedgerApp();
        const inputPayload = getInputElement('transact-input');
        const hdPath = getInputElement('transact-path');

        const tx = txDecode(inputPayload);
        const signed_tx = await ledgerSignMultisigTx(app, hdPath, tx);
        const info = getAuthFieldInfo(tx);
        const encoded = txEncode(signed_tx);
        displayMessage('tx', `Signed payload (${info.signatures}/${info.signaturesRequired} required signatures): <br/> <br/> ${encoded}`, 'Signed Transaction')
    } catch(e: any) {
        displayMessage('tx', e.toString(), "Error signing transaction");
        throw e;
    }
}

export async function generate_transfer() {
    const fromAddr = getInputElement('from-address');
    const fromPKsHex = getInputElement('from-pubkeys').split(',').map(x => x.trim()).sort();
    const reqSignatures = parseInt(getInputElement('from-n'));
    const recipient = getInputElement('to-address');
    const amount = getInputElement('stacks-send');
    const fee = getInputElement('stacks-fee');
    const nonce = getInputElement('nonce');
    const network = getInputElement('stacks-network');
    const spendingFields = fromPKsHex.map(x => ({ publicKey: x }));

    const generatedMultiSigAddress = makeMultiSigAddr(fromPKsHex, reqSignatures);

    if (generatedMultiSigAddress !== fromAddr) {
        const message = `Public keys, required signers do not match expected address: expected=${fromAddr}, generated=${generatedMultiSigAddress}`;
        displayMessage('tx', message, "Error generating transaction");
        throw new Error(message);
    }

    const multisigData: MultisigTxInput = {
        tx: {
            fee,
            amount,
            reqSignatures,
            recipient,
            nonce,
            network
        },
        spendingFields,
    };

    const tx = await makeStxTokenTransferFrom(multisigData);

    const encoded = txEncode(tx);
    displayMessage('tx', `Payload: <br/> <br/> ${encoded}`, 'Unsigned Transaction')
}

export async function broadcastTransaction() {
    const encodedTx = getInputElement('broadcast-input');
    const tx = txDecode(encodedTx);
    const res = await StxTx.broadcastTransaction(tx);
    displayMessage('tx', JSON.stringify(res, null, 2), 'Broadcast Transaction')
}

export async function checkDecode() {
    const encodedTx = getInputElement('check-decode-input');
    const tx = txDecode(encodedTx);
    displayMessage('tx', `<pre><code>${JSON.stringify(tx, null, 2)}</code></pre>`, 'Decoded Transaction')
}