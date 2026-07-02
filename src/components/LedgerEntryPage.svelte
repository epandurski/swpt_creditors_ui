<script lang="ts">
  import type { LedgerEntryModel, ExtendedLedgerEntry, AppState } from '../app-state'
  import { getContext } from 'svelte'
  import { amountToLocaleString } from '../format-amounts'
  import { parseTransferNote } from '../payment-requests'
  import Fab, { Icon } from '@smui/fab'
  import LayoutGrid, { Cell } from '@smui/layout-grid'
  import Page from './Page.svelte'
  import Paper, { Title, Content } from '@smui/paper'
  
  export let model: LedgerEntryModel
  export const snackbarBottom: string = "84px"
  
  const app: AppState = getContext('app')

  const dumyPaymentInfo = {
    payeeName: '',
    payeeReference: '',
    description: { contentFormat: '', content: ''},
  }
  
  function goBack(): void {
    app.startInteraction()
    model.goBack?.()
  }

  function getDate(t: ExtendedLedgerEntry): string {
    return new Date(t.addedAt).toLocaleString()
  }

  function calcDisplayAmount(amt: bigint): string {
    const amount = Number(amt) * pegBound.exchangeRate
    const { amountDivisor, decimalPlaces } = pegBound.display
    const unitAmount = amountToLocaleString(amount, amountDivisor, decimalPlaces)
    const unit = pegBound.display.unit
    return `${unitAmount}\u00a0${unit}`
  }

  $: accountData = model.accountData
  $: pegBounds = accountData.pegBounds
  $: pegBound = pegBounds[0]
  $: display = accountData.display
  $: debtorName = display.debtorName
  $: transfer = model.ledgerEntry
  $: committedTransfer = transfer.transfer
  $: rationale = committedTransfer?.rationale
  $: paymentInfo = committedTransfer ? parseTransferNote(committedTransfer) : dumyPaymentInfo
  $: payeeName = paymentInfo.payeeName
  $: description = paymentInfo.description
  $: payeeReference = paymentInfo.payeeReference
  $: contentFormat = description.contentFormat
  $: content = description.content
  $: amount = transfer.acquiredAmount
  $: displayAmount = calcDisplayAmount(amount)
</script>

<style>
  h5 {
    margin-top: 28px;
    font-family: Roboto, sans-serif;
    font-size: 1.1em;
    font-weight: bold;
  }
  a {
    font-family: Roboto, sans-serif;
    overflow-wrap: break-word;
    width: 100%;
  }
  pre {
    color: #888;
    font-family: "Roboto Mono", monospace;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    width: 100%;
  }
  .transfer {
    font-family: "Cutive Mono", monospace;
    font-size: 1.1em;
    line-height: 1.25;
    word-break: break-word;
    margin: 16px 0 0 1.5em;
    text-indent: -1.5em;
  }
  .transfer span {
    font-size: 1.2em;
  }
  .transfer-note {
    margin-top: 28px;
  }
  .fab-container {
    margin: 16px 16px;
  }
</style>

<Page title="Payment">
  <svelte:fragment slot="content">
    <LayoutGrid>
      <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
        <Paper style="margin-top: 12px; margin-bottom: 24px; word-break: break-word" elevation={6}>
          <Title>
            Payment via "{debtorName}"
          </Title>
          <Content>
            <h5>{getDate(transfer)}</h5>
            <p class="transfer">
              <span>{displayAmount}</span>
              {#if rationale === 'interest'}
                interest payment
              {:else if rationale === 'agent'}
                automatic exchange
              {:else if amount < 0 && payeeName}
                paid to "{payeeName}"
              {:else if amount > 0 && committedTransfer && committedTransfer.noteFormat !== '.' && payeeReference}
                toward "{payeeReference.slice(0, 36)}"
              {/if}
            </p>
              {#if contentFormat === '.' || contentFormat === '-'}
                <p class="transfer-note">
                  <a href="{description.content}" target="_blank" rel="noreferrer" on:click|stopPropagation>{content}</a>
                </p>
              {:else if contentFormat === '' && content}
                <pre class="transfer-note">{content}</pre>
              {/if}
          </Content>
        </Paper>
      </Cell>
    </LayoutGrid>
  </svelte:fragment>

  <svelte:fragment slot="floating">
    <div class="fab-container">
      <Fab on:click={goBack} color="primary">
        <Icon class="material-icons">arrow_back</Icon>
      </Fab>
    </div>
  </svelte:fragment>
</Page>
