<script lang="ts">
  import type { AppState, OverrideCoinModel, ApprovePegActionWithId } from '../app-state'
  import Fab, { Label } from '@smui/fab'
  import Paper, { Title, Content } from '@smui/paper'
  import LayoutGrid, { Cell } from '@smui/layout-grid'
  import Radio from '@smui/radio'
  import Button, { Label as ButtonLabel } from '@smui/button'
  import FormField from '@smui/form-field'
  import { Title as DialogTitle, Content as DialogContent, Actions } from '@smui/dialog'
  import Dialog from './Dialog.svelte'
  import Page from './Page.svelte'
  import LinkPopup from './LinkPopup.svelte'

  export let app: AppState
  export let model: OverrideCoinModel
  export const snackbarBottom: string = "84px"

  let shakingElement: HTMLElement
  let showKnownCoinList = false
  let showNewCoinList = false
  let actionManager = app.createActionManager(model.action, createUpdatedAction)
  let replace: 'yes' | 'no' = model.action.editedReplaceCoin ? 'yes' : 'no'

  function createUpdatedAction(): ApprovePegActionWithId {
    return {
      ...action,
      editedReplaceCoin,
    }
  }

  function shakeForm(): void {
    const shakingSuffix = ' shaking-block'
    const origClassName = shakingElement.className
    if (!origClassName.endsWith(shakingSuffix)) {
      shakingElement.className += shakingSuffix
      setTimeout(() => { shakingElement && (shakingElement.className = origClassName) }, 1000)
    }
  }

  function submit(): void {
    app.startInteraction()
    if (editedReplaceCoin === undefined) {
      shakeForm()
    } else {
      app.resolveCoinConflict(actionManager, editedReplaceCoin, pegAccount.uri)
    }
  }

  $: action = model.action
  $: editedReplaceCoin = replace === 'yes' || (replace === 'no' ? false : undefined)
  $: peggedDisplay = model.peggedAccountDisplay
  $: peggedDebtorName = peggedDisplay.debtorName
  $: peggedKnownDebtor = peggedDisplay.knownDebtor
  $: pegAccount = model.createAccountData.account
  $: pegDebtorName = pegAccount.display.debtorName
  $: knownCoinList = app.accountsMap.getDebtorNamesSuggestingGivenCoin(
    pegAccount.uri,
    model.createAccountData.debtorData.latestDebtorInfo.uri,
  )
  $: newCoinList = app.accountsMap.getDebtorNamesSuggestingGivenCoin(
    pegAccount.uri,
    action.peg.latestDebtorInfo.uri,
  )
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
  <Page title="Resolve conflict">
    <svelte:fragment slot="content">
      {#if showKnownCoinList}
        <Dialog
          open
          aria-labelledby="show-known-currencies-dialog-title"
          aria-describedby="show-known-currencies-dialog-content"
          on:MDCDialog:closed={() => showKnownCoinList = false}
          >
          <DialogTitle>Currencies using the already known coin:</DialogTitle>
          <DialogContent style="word-break: break-word">
            <ul class="currency-list">
              {#each knownCoinList as currencyName }
                <li>{currencyName}</li>
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

      {#if showNewCoinList}
        <Dialog
          open
          aria-labelledby="show-new-currencies-dialog-title"
          aria-describedby="show-new-currencies-dialog-content"
          on:MDCDialog:closed={() => showNewCoinList = false}
          >
          <DialogTitle>Currencies suggesting the same coin as "{peggedDebtorName}":</DialogTitle>
          <DialogContent style="word-break: break-word">
            <ul class="currency-list">
              {#each newCoinList as currencyName }
                <li>{currencyName}</li>
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
                <Title>
                  Digital coin conflict
                </Title>
                <Content>
                  <p>
                    "{peggedDebtorName}"
                    {#if !peggedKnownDebtor}
                      (unconfirmed account)
                    {/if}
                    has declared a fixed exchange rate with
                    "{pegDebtorName}". However, the digital coin
                    declared for "{pegDebtorName}" does not match the
                    already known coin for it.
                  </p>
                    <ul class="checklist">
                      <li>
                        {#if knownCoinList.length === 0}
                          The already known coin is not used by any pegged currencies.
                        {:else if knownCoinList.length === 1}
                          <LinkPopup bind:show={showKnownCoinList}>1 pegged currency</LinkPopup>
                          uses the already known coin.
                        {:else}
                          <LinkPopup bind:show={showKnownCoinList}>{knownCoinList.length.toLocaleString()} pegged currencies</LinkPopup>
                          use the already known coin.
                        {/if}
                      </li>
                      {#if newCoinList.length > 0}
                        <li>
                          {#if newCoinList.length === 1}
                            <LinkPopup bind:show={showNewCoinList}>1 pegged currency</LinkPopup>
                            suggests the same coin as "{peggedDebtorName}".
                          {:else}
                            <LinkPopup bind:show={showNewCoinList}>{newCoinList.length.toLocaleString()} pegged currencies</LinkPopup>
                            suggest the same coin as "{peggedDebtorName}".
                          {/if}
                        </li>
                      {/if}
                    </ul>
                </Content>
              </Paper>
            </Cell>

            <Cell spanDevices={{ desktop: 6, tablet: 4, phone: 4 }}>
              <div class="radio-group" style="margin-top: -10px; word-break: break-word">
                <FormField>
                  <Radio bind:group={replace} value="no" touch />
                  <span slot="label">Use the already known coin.</span>
                </FormField>
                <FormField>
                  <Radio bind:group={replace} value="yes" touch />
                  <span slot="label">
                    It seems like the known coin is obsolete or
                    fake. Replace it with the coin that
                    "{peggedDebtorName}" declares.
                  </span>
                </FormField>
              </div>
            </Cell>
          </LayoutGrid>
        </form>
      </div>
    </svelte:fragment>

    <svelte:fragment slot="floating">
      <div class="fab-container">
        <Fab color="primary" on:click={submit} extended>
          <Label>Resolve</Label>
        </Fab>
      </div>
    </svelte:fragment>
  </Page>
</div>
