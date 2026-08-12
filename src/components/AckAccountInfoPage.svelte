<script lang="ts">
  import type { AppState, AckAccountInfoModel } from '../app-state'
  import { Title as DialogTitle, Content as DialogContent, Actions, InitialFocus } from '@smui/dialog'
  import Button, { Label } from '@smui/button'
  import LayoutGrid, { Cell } from '@smui/layout-grid'
  import Fab, { Label as FabLabel } from '@smui/fab'
  import Paper, { Title, Content } from '@smui/paper'
  import Page from './Page.svelte'
  import Dialog from './Dialog.svelte'
  import EnterPinDialog from './EnterPinDialog.svelte'
  import LinkPopup from './LinkPopup.svelte'

  export let app: AppState
  export let model: AckAccountInfoModel
  export const snackbarBottom: string = "84px"

  assert(model.account.display.debtorName !== undefined)

  let showSummary: boolean = false
  let showLink: boolean = false
  let openEnterPinDialog: boolean = false

  function acknowlege(): void {
    app.startInteraction()
    const previousPegMustBeRemoved = action.previousPeg !== undefined && action.changes.pegParams
    if (previousPegMustBeRemoved) {
      openEnterPinDialog = true
    } else {
      submit()
    }
  }

  function submit(pinForPegRemoval?: string): void {
    app.acknowlegeAckAccountInfoAction(action, model.account, pinForPegRemoval, model.goBack)
  }

  $: action = model.action
  $: knownDebtor = model.account.display.knownDebtor
  $: debtorName = model.account.display.debtorName
  $: changes = action.changes
  $: debtorData = action.debtorData
  $: interestRateChangeDate = new Date(action.interestRateChangedAt).toLocaleDateString()
  $: interestRate = action.interestRate.toLocaleString(undefined, {maximumFractionDigits: 3})
  $: positiveInterestRate = action.interestRate > 0
  $: negativeInterestRate = action.interestRate < 0
  $: configError = action.configError
</script>

<style>
  .fab-container {
    margin: 16px 16px;
  }
  ul {
    list-style: square outside;
    margin: 0.75em 1.25em 0 1.25em;
  }
  li {
    margin-top: 0.5em;
  }
</style>

<Page title="Acknowledge changes" hideFloating={openEnterPinDialog}>
  <svelte:fragment slot="content">
    <EnterPinDialog bind:open={openEnterPinDialog} performAction={submit} />

    {#if showSummary}
      <Dialog
        open
        aria-labelledby="show-summary-dialog-title"
        aria-describedby="show-summary-dialog-content"
        on:MDCDialog:closed={() => showSummary = false}
        >
        <DialogTitle>The new currency summary:</DialogTitle>
        <DialogContent style="word-break: break-word">{debtorData.summary}</DialogContent>
        <Actions>
          <Button>
            <Label>Close</Label>
          </Button>
        </Actions>
      </Dialog>
    {/if}

    {#if showLink}
      <Dialog
        open
        aria-labelledby="show-link-dialog-title"
        aria-describedby="show-link-dialog-content"
        on:MDCDialog:closed={() => showLink = false}
        >
        <DialogTitle>The new digital coin link:</DialogTitle>
        <DialogContent style="word-break: break-word">
          <a href="{debtorData.latestDebtorInfo.uri}" target="_blank" rel="noreferrer">{debtorData.latestDebtorInfo.uri}</a>
        </DialogContent>
        <Actions>
          <Button use={[InitialFocus]}>
            <Label>Close</Label>
          </Button>
        </Actions>
      </Dialog>
    {/if}

    <div class="text-container">
      <LayoutGrid>
        <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
          <Paper style="margin-top: 12px; margin-bottom: 24px; word-break: break-word" elevation={6}>
            <Title>
              Changes in "{debtorName}"
              {#if !knownDebtor}
                (unconfirmed account)
              {/if}
            </Title>
            <Content>
              <ul>
                {#if changes.configError}
                  <li>
                    {#if configError === undefined}
                      The previously experienced account configuration
                      problem has been resolved. Now your account is
                      configured correctly.
                    {:else if configError === 'NO_CONNECTION_TO_DEBTOR'}
                      No connection can be made to the servers that manage
                      this currency. You will not be able to send or
                      receive money from this account, but you still can
                      peg other currencies to it.
                    {:else if configError === 'CONFIGURATION_IS_NOT_EFFECTUAL'}
                      An account configuration problem has occurred.
                      Usually this means that temporarily, a connection
                      can not be made to the servers that manage this
                      currency.
                    {:else}
                      An account configuration problem has occurred: {configError}.
                    {/if}
                  </li>
                {/if}

                {#if changes.amountDivisor || changes.decimalPlaces || changes.unit}
                  <li>
                    The issuer has declared a new official way to display
                    currency amounts. Later, you will be asked to approve
                    this important change.
                  </li>
                {/if}

                {#if changes.debtorName}
                  <li>
                    The official name of the currency has been changed to
                    "{debtorData.debtorName}". Later, you will be asked to
                    approve this important change.
                  </li>
                {/if}

                {#if changes.pegParams || changes.pegDebtorInfoUri}
                  <li>
                    {#if debtorData.peg}
                      {#if action.previousPeg}
                        {#if !changes.pegParams}
                          The issuer has specified a different digital
                          coin (a QR code) for the already declared peg
                          currency. Later, you may be asked to approve
                          this change.
                        {:else}
                          The issuer has declared a new, different
                          currency peg. Later, you will be asked to
                          approve the new peg.
                        {/if}
                      {:else}
                        The issuer has declared a fixed exchange rate
                        between this currency and some other
                        currency. Later, you will be asked to approve this
                        currency peg.
                      {/if}
                    {:else}
                      The previously declared currency peg has been removed.
                    {/if}
                  </li>
                {/if}

                {#if changes.interestRate}
                  <li>
                    On {interestRateChangeDate} the issuer changed the
                    annual interest rate on your account to
                    {interestRate}%.
                    {#if positiveInterestRate}
                      A positive interest rate means that your available amount will increase over time.
                    {:else if negativeInterestRate}
                      A negative interest rate means that your available amount will decrease over time.
                    {/if}
                  </li>
                {/if}

                {#if changes.debtorHomepage}
                  <li>
                    {#if debtorData.debtorHomepage}
                      The official home page of the currency has been <a href="{debtorData.debtorHomepage.uri}" target="_blank" rel="noreferrer">changed</a>.
                    {:else}
                      The official home page of the currency has been changed.
                    {/if}
                  </li>
                {/if}

                {#if changes.summary}
                  <li>
                    {#if debtorData.summary}
                      The official currency summary, as stated by the issuer,
                      has been <a href="." target="_blank" on:click|preventDefault={() => showSummary = true}>updated</a>.
                    {:else}
                      The official currency summary, stated by the issuer,
                      has been removed.
                    {/if}
                    {#if debtorData.debtorHomepage}
                      You may find more information on the <a href="{debtorData.debtorHomepage.uri}" target="_blank" rel="noreferrer">homepage</a>.
                    {/if}
                  </li>
                {/if}

                {#if changes.latestDebtorInfo}
                  <li>
                    The digital coin (the QR code) of the currency has
                    changed. The new digital coin contains a different
                    <LinkPopup bind:show={showLink}>link</LinkPopup>
                  </li>
                {/if}

                {#if changes.otherChanges}
                  <li>
                    Some unimportant technical details in the description
                    of the currency have been changed.
                  </li>
                {/if}
              </ul>
            </Content>
          </Paper>
        </Cell>
      </LayoutGrid>
    </div>
  </svelte:fragment>

  <svelte:fragment slot="floating">
    <div class="fab-container">
      <Fab color="primary" on:click={acknowlege} extended>
        <FabLabel>Acknowlege</FabLabel>
      </Fab>
    </div>
  </svelte:fragment>
</Page>
