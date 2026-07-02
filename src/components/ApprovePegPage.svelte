<script lang="ts">
  import type { AppState, ApprovePegModel, ApprovePegActionWithId } from '../app-state'
  import { amountToLocaleString, calcPegExampleAmount, MAX_INT64 } from '../format-amounts'
  import Button, { Label as ButtonLabel } from '@smui/button'
  import Fab, { Label } from '@smui/fab'
  import Paper, { Title, Content } from '@smui/paper'
  import LayoutGrid, { Cell } from '@smui/layout-grid'
  import Radio from '@smui/radio'
  import FormField from '@smui/form-field'
  import Dialog from './Dialog.svelte'
  import { Title as DialogTitle, Content as DialogContent, Actions } from '@smui/dialog'
  import Page from './Page.svelte'
  import EnterPinDialog from './EnterPinDialog.svelte'
  import LinkPopup from './LinkPopup.svelte'

  export let app: AppState
  export let model: ApprovePegModel
  export const snackbarBottom: string = "84px"

  const MAX_AMOUNT = Number(MAX_INT64)

  let showCurrencies = false
  let shakingElement: HTMLElement
  let openEnterPinDialog = false
  let actionManager = app.createActionManager(model.action, createUpdatedAction)
  let approved = getYesNoUnknown(model.action.editedApproval)

  function getYesNoUnknown(x?: boolean): 'yes' | 'no' | '' {
    switch (x) {
    case true:
      return 'yes'
    case false:
      return 'no'
    default:
      return ''
    }
  }

  function createUpdatedAction(): ApprovePegActionWithId {
    return {
      ...action,
      editedApproval,
    }
  }

  function confirm(): void {
    app.startInteraction()
    if (editedApproval === undefined) {
      shakeForm()
    } else if (editedApproval === action.alreadyHasApproval) {
      // No change has been made, so no PIN is required.
      submit(undefined)
    } else {
      // The choice has been altered, so PIN is required.
      openEnterPinDialog = true
    }
  }

  function calcFinalUnitAmount(accountUri: string, amount: number): string | undefined {
    const bounds = app.accountsMap.followPegChain(accountUri)
    const bound = bounds[bounds.length - 1]
    if (bound && bound.accountUri !== accountUri) {
      const finalUnitAmount = amountToLocaleString(
        Math.min(amount * bound.exchangeRate, MAX_AMOUNT),
        bound.display.amountDivisor,
        bound.display.decimalPlaces,
      ) + ' ' + bound.display.unit
      return finalUnitAmount
    }
    return undefined
  }

  function shakeForm(): void {
    const shakingSuffix = ' shaking-block'
    const origClassName = shakingElement.className
    if (!origClassName.endsWith(shakingSuffix)) {
      shakingElement.className += shakingSuffix
      setTimeout(() => { shakingElement && (shakingElement.className = origClassName) }, 1000)
    }
  }

  function submit(pin: string | undefined): void {
    if (editedApproval !== undefined) {
      app.resolveApprovePegAction(
        actionManager,
        editedApproval,
        model.pegAccountUri,
        model.exchangeLatestUpdateId,
        pin,
        model.goBack,
      )
    }
  }

  $: action = model.action
  $: exampleAmount = calcPegExampleAmount(peggedDisplay, pegDisplay, action.peg.exchangeRate)
  $: peggedDisplay = model.peggedAccountDisplay
  $: peggedDebtorName = peggedDisplay.debtorName
  $: peggedKnownDebtor = peggedDisplay.knownDebtor
  $: peggedAmountString = amountToLocaleString(
    exampleAmount,
    peggedDisplay.amountDivisor,
    peggedDisplay.decimalPlaces,
  )
  $: peggedUnitAmount = peggedAmountString + ' ' + peggedDisplay.unit
  $: pegDisplay = action.peg.display
  $: pegDebtorName = model.pegDebtorName
  $: pegAmount = exampleAmount * action.peg.exchangeRate
  $: pegAmountString = amountToLocaleString(
    Math.min(pegAmount, MAX_AMOUNT),
    pegDisplay.amountDivisor,
    pegDisplay.decimalPlaces,
  )
  $: pegUnitAmount = pegAmountString + ' ' + pegDisplay.unit
  $: finalUnitAmount = calcFinalUnitAmount(model.pegAccountUri, pegAmount)
  $: currencyList = app.accountsMap.getRecursivelyPeggedDebtorNames(action.accountUri)
  $: editedApproval = approved === 'yes' || (approved === 'no' ? false : undefined)
</script>

<style>
  .checklist {
    list-style: disc outside;
    margin: 0.75em 1.25em 0 16px;
  }
  .checklist li {
    margin-top: 0.5em;
  }
  .currency-list {
    list-style: square outside;
    margin: 0.75em 1.25em 0 1.25em;
  }
  .amount {
    font-size: 1.1em;
  }
  .fab-container {
    margin: 16px 16px;
  }
  .shaking-container {
    position: relative;
    overflow: hidden;
  }
  .radio-group > :global(*) {
    margin: 0 0.2em;
  }

  @keyframes shake {
    0% { transform: translate(1px, 1px) rotate(0deg); }
    10% { transform: translate(-1px, -2px) rotate(-1deg); }
    20% { transform: translate(-3px, 0px) rotate(1deg); }
    30% { transform: translate(3px, 2px) rotate(0deg); }
    40% { transform: translate(1px, -1px) rotate(1deg); }
    50% { transform: translate(-1px, 2px) rotate(-1deg); }
    60% { transform: translate(-3px, 1px) rotate(0deg); }
    70% { transform: translate(3px, 1px) rotate(-1deg); }
    80% { transform: translate(-1px, -1px) rotate(1deg); }
    90% { transform: translate(1px, 2px) rotate(0deg); }
    100% { transform: translate(1px, -2px) rotate(-1deg); }
  }

  :global(.shaking-block) {
    animation: shake 0.5s;
    animation-iteration-count: 1;
  }
</style>

<div class="shaking-container">
  <Page title="Approve peg" hideFloating={openEnterPinDialog}>
    <svelte:fragment slot="content">
      <EnterPinDialog bind:open={openEnterPinDialog} performAction={submit} />

      {#if showCurrencies}
        <Dialog
          open
          aria-labelledby="show-currencies-dialog-title"
          aria-describedby="show-currencies-dialog-content"
          on:MDCDialog:closed={() => showCurrencies = false}
          >
          <DialogTitle>Indirectly pegged currencies:</DialogTitle>
          <DialogContent style="word-break: break-word">
            <ul class="currency-list">
              {#each currencyList as currency }
                <li>{currency}</li>
              {/each}
            </ul>
          </DialogContent>
          <Actions>
            <Button>
              <ButtonLabel>Close</ButtonLabel>
            </Button>
          </Actions>
        </Dialog>
      {/if}

      <div bind:this={shakingElement}>
        <form
          noValidate
          autoComplete="off"
          on:input={() => actionManager.markDirty()}
          on:change={() => actionManager.save()}
          >
          <LayoutGrid>
            <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
              <Paper style="margin-top: 12px; margin-bottom: 24px; word-break: break-word" elevation={6}>
                <Title>Currency peg</Title>
                <Content>
                  <p>
                    "{peggedDebtorName}"
                    {#if !peggedKnownDebtor}
                      (unconfirmed account)
                    {/if}
                    has declared a fixed exchange rate with
                    "{pegDebtorName}". If this peg is approved:
                  </p>
                  <ul class="checklist">
                    <li>
                      Every
                      <em class="amount">{peggedUnitAmount}</em> in your account
                      with "{peggedDebtorName}", will be considered
                      equivalent to
                      <em class="amount">{pegUnitAmount}</em>.
                    </li>
                    {#if finalUnitAmount !== undefined }
                      <li>
                        As "{pegDebtorName}" is by itself pegged to
                        another currency, every
                        <em class="amount">{peggedUnitAmount}</em> in
                        your account with "{peggedDebtorName}", will
                        also be considered equivalent to
                        <em class="amount">{finalUnitAmount}</em>.
                      </li>
                    {/if}
                    {#if currencyList.length > 0}
                      <li>
                        {#if currencyList.length === 1}
                          <LinkPopup bind:show={showCurrencies}>1 other currency</LinkPopup>
                          will get indirectly pegged to
                          "{pegDebtorName}", which may change the
                          way its amounts are displayed.
                        {:else}
                          <LinkPopup bind:show={showCurrencies}>{currencyList.length.toLocaleString()} other currencies</LinkPopup>
                          will get indirectly pegged to
                          "{pegDebtorName}", which may change the
                          way their amounts are displayed.
                        {/if}
                      </li>
                    {/if}
                    <li>
                      More possibilities will exist for automatic
                      exchanges between currencies.
                    </li>
                  </ul>
                </Content>
              </Paper>
            </Cell>

            <Cell spanDevices={{ desktop: 6, tablet: 4, phone: 4 }}>
              <div class="radio-group" style="margin-top: -10px; word-break: break-word">
                <FormField>
                  <Radio bind:group={approved} value="yes" touch />
                  <span slot="label">Approve this peg</span>
                </FormField>
                <FormField>
                  <Radio bind:group={approved} value="no" touch />
                  <span slot="label">Do not approve this peg</span>
                </FormField>
              </div>
            </Cell>
          </LayoutGrid>
        </form>
      </div>
      </svelte:fragment>

    <svelte:fragment slot="floating">
      <div class="fab-container">
        <Fab color="primary" on:click={confirm} extended>
          <Label>Submit decision</Label>
        </Fab>
      </div>
    </svelte:fragment>
  </Page>
</div>
