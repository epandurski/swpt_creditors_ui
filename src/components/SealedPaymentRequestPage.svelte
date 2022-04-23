<script lang="ts">
  import type { AppState, SealedPaymentRequestModel } from '../app-state'
  import { amountToString } from '../format-amounts'
  import { onMount, onDestroy } from 'svelte'
  import Fab, { Icon } from '@smui/fab'
  import { Row } from '@smui/top-app-bar'
  import { Title as DialogTitle, Content as DialogContent, Actions, InitialFocus } from '@smui/dialog'
  import Paper, { Title, Content } from '@smui/paper'
  import Button, { Label } from '@smui/button'
  import Chip, { Text } from '@smui/chips'
  import QrGenerator from './QrGenerator.svelte'
  import Page from './Page.svelte'
  import Dialog from './Dialog.svelte'
  import DoneSvgIcon from './DoneSvgIcon.svelte'

  export let app: AppState
  const { pageModel } = app
  export let model: SealedPaymentRequestModel
  export const snackbarBottom: string = "84px"
  export const scrollElement = document.documentElement

  assert(model.action.sealedAt !== undefined)

  let doneIcon: HTMLElement
  let showConfirmDialog = false
  let downloadImageElement: HTMLAnchorElement
  let downloadTextElement: HTMLAnchorElement
  let actionManager = app.createActionManager(model.action)
  let imageDataUrl: string = ''
  let textDataUrl: string = URL.createObjectURL(new Blob([model.paymentRequest]))

  function rotateDoneIcon(): void {
    if (done && doneIcon) {
      doneIcon.className += ' rotate'
    }
  }

  function showAccount(): void {
    const m = {
      ...model,
      scrollTop: scrollElement.scrollTop,
      scrollLeft: scrollElement.scrollLeft,
    }
    app.showAccount(accountUri, () => app.pageModel.set(m))
  }

  function update(): void {
    app.fetchDataFromServer(() => $pageModel.reload())
  }

  function revokeTextDataUrl() {
    if (textDataUrl) {
      URL.revokeObjectURL(textDataUrl)
    }
  }

  onMount(rotateDoneIcon)
  onDestroy(revokeTextDataUrl)

  $: action = model.action
  $: accountUri = action.accountUri
  $: sealedAt = action.sealedAt
  $: done = true
  $: accountData = model.accountData
  $: display = accountData.display
  $: debtorName = display.debtorName
  $: amountDivisor = display.amountDivisor
  $: decimalPlaces = display.decimalPlaces
  $: amount = action.editedAmount ?? 0n
  $: deadline = new Date(action.editedDeadline)
  $: unitAmount = amountToString(amount, amountDivisor, decimalPlaces)
  $: unit = display.unit ?? '\u00a4'
  $: payeeName = action.editedPayeeName
  $: fileName = `${debtorName} - ${action.payeeReference.slice(0, 8)}`
  $: imageFileName = `${fileName}.png`
  $: textFileName = `${fileName}.pr0`
</script>

<style>
  .empty-space {
    height: 72px;
  }
  pre {
    color: #888;
    margin-top: 16px;
    font-size: 0.9em;
    font-family: monospace;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    width: 100%;
  }
  .received-box {
    width: 100%;
    height: 100%;
    color: black;
    background-color: #f4f4f4;
    border-bottom: 1px solid #ccc;
    display: flex;
    justify-content: center;
    align-items: center;
    overflow: hidden;
  }
  .received-amount-container {
    flex-grow: 1;
    margin-left: 10px;
    word-break: break-word;
  }
  .received-text {
    font-size: 13px;
    font-family: Roboto,sans-serif;
    color: #888;
  }
  .received-amount {
    margin-top: 5px;
    font-size: 22px;
    font-family: Courier,monospace;
  }
  .received-icon {
    flex-grow: 0;
    width: 60px;
    padding-right: 6px;
  }
  .text-container {
    display: flex;
    width: 100%;
    justify-content: center;
  }
  .qrcode-container {
    width: 100%;
    text-align: center;
  }
  .qrcode-container :global(img) {
    width: 100%;
    max-width: 66vh;
  }
  .download-link {
    display: none;
  }
  .fab-container {
    margin: 16px 16px;
  }

  @keyframes rotate {
    0% { transform: scale(0.3, 0.3) rotate(0deg); }
    100% { transform: scale(1, 1) rotate(720deg); }
  }

  :global(.rotate) {
    animation: rotate 0.8s;
    animation-iteration-count: 1;
  }
</style>

<div>
  <Page title="Request payment" scrollTop={model.scrollTop} scrollLeft={model.scrollLeft}>
    <svelte:fragment slot="app-bar">
      <Row style="height: 72px">
        <div class="received-box">
          <div class="received-amount-container">
            <div class="received-text">received</div>
            <div class="received-amount">10000000.00 EUR</div>
          </div>
          <div bind:this={doneIcon} class="received-icon">
            {#if done}
              <DoneSvgIcon />
            {/if}
          </div>
        </div>
      </Row>
    </svelte:fragment>

    <svelte:fragment slot="content">
      <div slot="content">
        <div class="empty-space"></div>
        <div class="qrcode-container">
          <QrGenerator value={model.paymentRequest} bind:dataUrl={imageDataUrl} />
        </div>
        <a class="download-link" href={imageDataUrl} download={imageFileName} bind:this={downloadImageElement}>
          download
        </a>
        <a class="download-link" href={textDataUrl} download={textFileName} bind:this={downloadTextElement}>
          download
        </a>
        <div class="text-container">
          <Paper elevation={8} style="margin: 0 16px 24px 16px; max-width: 600px; word-break: break-word">
            <Title>
              <Chip chip="account" style="float: right; margin-left: 6px">
                <Text>
                  <a href="." style="text-decoration: none; color: #666" on:click|preventDefault={showAccount}>
                    account
                  </a>
                </Text>
              </Chip>
              Payment via "{debtorName}"
            </Title>
            <Content>
              <a href="qr" target="_blank" on:click|preventDefault={() => downloadImageElement?.click()}>
                The QR code above
              </a>
              {#if amount === 0n}
                represents a generic payment request from "{payeeName}".
              {:else}
                represents a request {unitAmount} {unit} to be paid to "{payeeName}".
              {/if}

              The request has been created at {sealedAt?.toLocaleString()}.

              {#if deadline.getTime()}
                The deadline for the payment is {deadline.toLocaleString()}.
              {/if}

              {#if action.editedNote}
                <pre>{action.editedNote}</pre>
              {/if}
            </Content>
          </Paper>
        </div>
      </div>

      {#if showConfirmDialog}
        <Dialog
          open
          scrimClickAction=""
          aria-labelledby="confirm-delete-dialog-title"
          aria-describedby="confirm-delete-dialog-content"
          on:MDCDialog:closed={() => showConfirmDialog = false}
          >
          <DialogTitle id="confirm-delete-dialog-title">Delete payment request</DialogTitle>
          <DialogContent id="confirm-delete-dialog-content">
            If you delete this payment request, you will no longer be
            able to watch the corresponding payments. Are you sure
            you want to do this?
          </DialogContent>
          <Actions>
            <Button>
              <Label>No</Label>
            </Button>
            <Button default use={[InitialFocus]} on:click={() => actionManager.remove()}>
              <Label>Yes</Label>
            </Button>
          </Actions>
        </Dialog>
      {/if}
    </svelte:fragment>

    <svelte:fragment slot="floating">
      <div class="fab-container">
        <Fab on:click={() => downloadTextElement.click()}>
          <Icon class="material-icons">download</Icon>
        </Fab>
      </div>
      <div class="fab-container">
        <Fab on:click={update}>
          <Icon class="material-icons">sync</Icon>
        </Fab>
      </div>
      <div class="fab-container">
        <Fab color="primary" on:click={() => showConfirmDialog = true}>
          <Icon class="material-icons">close</Icon>
        </Fab>
      </div>
    </svelte:fragment>
  </Page>
</div>