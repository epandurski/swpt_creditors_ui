<script lang="ts">
  import type { ExtendedLedgerEntry, PegBound, AppState } from '../app-state'
  import { getContext } from 'svelte'
  import { amountToLocaleString } from '../format-amounts'
  import { parseTransferNote } from '../payment-requests'
  import Card, { PrimaryAction, Content } from '@smui/card'

  export let transfer: ExtendedLedgerEntry
  export let pegBound: PegBound
  export let activate: () => void

  const app: AppState = getContext('app')

  const dumyPaymentInfo = {
    payeeName: '',
    payeeReference: '',
    description: { contentFormat: '', content: ''},
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
  
  function calcBrief(s: string): string {
    const MAX_LENGTH = 120
    return (
      s.length <= MAX_LENGTH
        ? s
        : s.slice(0, MAX_LENGTH) + '\u2026'
    )
  }

  function showCommittedTransfer(): void {
    app.startInteraction()
    activate()
  }

  $: committedTransfer = transfer.transfer
  $: rationale = committedTransfer?.rationale
  $: paymentInfo = committedTransfer ? parseTransferNote(committedTransfer) : dumyPaymentInfo
  $: payeeName = paymentInfo.payeeName
  $: description = paymentInfo.description
  $: payeeReference = paymentInfo.payeeReference
  $: briefContent = calcBrief(description.content)
  $: amount = transfer.acquiredAmount
  $: displayAmount = calcDisplayAmount(amount)
</script>

<style>
  h5 {
    font-family: Roboto, sans-serif;
    font-size: 1.1em;
    font-weight: bold;
  }
  a {
    overflow-wrap: break-word;
    width: 100%;
  }
  .transfer {
    font-family: "Cutive Mono", monospace;
    font-size: 1.1em;
    line-height: 1.25;
    word-break: break-word;
    margin: 10px 0 0 1.5em;
    text-indent: -1.5em;
  }
  .transfer span {
    font-size: 1.2em;
  }
  .transfer-note {
    word-break: break-word;
    font-family: Roboto, sans-serif;
    margin-top: 10px;
    color: #888;
  }
</style>

<Card>
  <PrimaryAction on:click={showCommittedTransfer}>
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
      <p class="transfer-note">
        {#if description.contentFormat === '.' || description.contentFormat === '-'}
          <a href="{description.content}" target="_blank" rel="noreferrer" on:click|stopPropagation>{briefContent}</a>
        {:else if description.contentFormat === ''}
          {briefContent}
        {/if}
      </p>
    </Content>
  </PrimaryAction>
</Card>
