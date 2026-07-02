<script lang="ts">
  import type { PegBound, AppState } from '../app-state'
  import { getContext } from 'svelte'
  import { SUMMARY_TRANSLATIONS } from '../messages'
  import { amountToLocaleString } from '../format-amounts'
  import Chip, { Text } from '@smui/chips'
  import Tooltip, { Wrapper } from '@smui/tooltip'
  import Paper, { Title, Content } from '@smui/paper'

  export let homepage: string | undefined
  export let summary: string | undefined
  export let amount: bigint = 0n
  export let pegBounds: PegBound[] = []
  export let showAccount: ((accountUri: string) => void) | undefined = undefined
  export let elevation = 6
  export let style: string = 'margin-top: 12px; margin-bottom: 24px; word-break: break-word'

  const app: AppState = getContext('app')

  function followPeg(accountUri: string): void {
    app.startInteraction()
    showAccount?.(accountUri)
  }

  function calcDisplayAmount(amt: bigint, pegBound: PegBound): string {
    const x = Number(amt) * pegBound.exchangeRate
    const { amountDivisor, decimalPlaces } = pegBound.display
    const unitAmount = amountToLocaleString(x, amountDivisor, decimalPlaces)
    const unit = pegBound.display.unit
    return `${unitAmount}\u00a0${unit}`
  }

  function tryToTranslateSummary(summary: string): string {
    return SUMMARY_TRANSLATIONS?.[summary] || summary
  }
</script>

<style>
  .account-info {
    display: flex;
    flex-flow: row-reverse wrap;
  }
  .summary-box {
    color: #888;
    margin-top: 16px;
  }
  .amounts-box {
    flex: 0 1 20em;
  }
  .important-box {
    flex: 1 1 25em;
  }
  .amount {
    font-family: "Cutive Mono", monospace;
    font-size: 1.3em;
    text-align: right;
  }
  .amount a {
    color: rgb(0, 0, 0);
    text-decoration: none;
  }
  .single-amount {
    font-size: 1.1em;
  }
</style>

<Paper {style} {elevation}>
  <Title>
    {#if homepage}
      <Wrapper>
        <Chip chip="help" on:click={() => undefined} style="float: right; margin-left: 6px">
          <Text>
            <a href={homepage} target="_blank" rel="noreferrer" style="text-decoration: none; color: #666">info</a>
          </Text>
        </Chip>
        <Tooltip>{homepage}</Tooltip>
      </Wrapper>
    {/if}
    <slot name="title"></slot>
  </Title>
  <Content style="clear: both">
    <div class="account-info">
      <div class="amounts-box">
        {#each pegBounds as pegBound, index}
          <p class="amount">
            {#if index === 0}
              <span class:single-amount={pegBounds.length === 1}>
                &nbsp;&nbsp;{calcDisplayAmount(amount, pegBound)}
              </span>
            {:else}
              {#if showAccount !== undefined}
                <a href="." target="_blank" rel="noreferrer" on:click|preventDefault={() => followPeg(pegBound.accountUri)}>
                  =&nbsp;{calcDisplayAmount(amount, pegBound)}
                </a>
              {:else}
                =&nbsp;{calcDisplayAmount(amount, pegBound)}
              {/if}
            {/if}
          </p>
        {/each}
      </div>
      <div class="important-box">
        <slot name="important"></slot>
      </div>
    </div>
    <blockquote class="summary-box">
      {#if summary}
        {tryToTranslateSummary(summary)}
      {:else}
        <span style="color: #ccc">The issuer of the currency has not provided any currency description.</span>
      {/if}
    </blockquote>
    <slot name="content"></slot>
  </Content>
</Paper>
