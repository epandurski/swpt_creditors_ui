<script lang="ts">
  import type { AppState, UpdatePolicyModel, UpdatePolicyActionWithId, PegBound } from '../app-state'
  import {
    amountToString, limitAmountDivisor, calcPegExampleAmount, calcSmallestDisplayableNumber,
    MIN_INT64, MAX_INT64
  } from '../format-amounts'
  import { slide } from 'svelte/transition'
  import Fab, { Label } from '@smui/fab'
  import LayoutGrid, { Cell } from '@smui/layout-grid'
  import Textfield from '@smui/textfield'
  import TextfieldIcon from '@smui/textfield/icon'
  import HelperText from '@smui/textfield/helper-text/index'
  import FormField from '@smui/form-field'
  import Radio from '@smui/radio'
  import Checkbox from '@smui/checkbox'
  import Page from './Page.svelte'
  import EnterPinDialog from './EnterPinDialog.svelte'
  import AccountInfo from './AccountInfo.svelte'

  export let app: AppState
  export let model: UpdatePolicyModel
  export const snackbarBottom: string = "84px"

  const duration = 250

  let shakingElement: HTMLElement
  let openEnterPinDialog = false
  let actionManager = app.createActionManager(model.action, createUpdatedAction)
  let policy: '' | 'conservative' = model.action.editedPolicy === undefined ? '' : 'conservative'
  let minPrincipalUnitAmount: unknown = calcInitialMinPrincipalUnitAmount(model)
  let maxPrincipalUnitAmount: unknown = calcInitialMaxPrincipalUnitAmount(model)
  let useNonstandardPeg = model.action.editedUseNonstandardPeg
  let ignoreDeclaredPeg = model.action.editedIgnoreDeclaredPeg
  let reviseApprovedPeg = model.action.editedReviseApprovedPeg
  let invalidMinPrincipalUnitAmount: boolean | undefined
  let invalidMaxPrincipalUnitAmount: boolean | undefined

  function createUpdatedAction(): UpdatePolicyActionWithId {
    return {
      ...action,
      editedPolicy: policy === '' ? undefined : policy,
      editedMinPrincipal: minPrincipal,
      editedMaxPrincipal: maxPrincipal,
      editedUseNonstandardPeg: useNonstandardPeg,
      editedIgnoreDeclaredPeg: ignoreDeclaredPeg,
      editedReviseApprovedPeg: reviseApprovedPeg,
    }
  }

  function formatAsUnitAmount(
    amount: bigint | number | undefined,
    amountDivisor: number,
    decimalPlaces: bigint,
  ): string {
    if (amount === undefined) {
      return ''
    }
    return amountToString(amount, amountDivisor, decimalPlaces)
  }

  function calcInitialMinPrincipalUnitAmount(model: UpdatePolicyModel): string {
    let n: bigint | undefined = model.action.editedMinPrincipal
    if (n < 0n) {
      n = undefined
    }
    return formatAsUnitAmount(n, model.accountData.display.amountDivisor, model.accountData.display.decimalPlaces)
  }

  function calcInitialMaxPrincipalUnitAmount(model: UpdatePolicyModel): string {
    let n: bigint | undefined = model.action.editedMaxPrincipal
    if (n >= MAX_INT64) {
      n = undefined
    } else if (n < 0n) {
      n = 0n
    }
    return formatAsUnitAmount(n, model.accountData.display.amountDivisor, model.accountData.display.decimalPlaces)
  }

  function calcExampleAmount(pegBounds: PegBound[]): bigint {
    if (pegBounds.length >= 2) {
      const [pegged, peg] = pegBounds
      const amount = calcPegExampleAmount(pegged.display, peg.display, peg.exchangeRate)
      return BigInt(Math.round(amount))
    }
    return 0n
  }

  function amountToBigint(amount: unknown, divisor: number, defaultValue: bigint): bigint {
    let result = defaultValue
    if (amount !== '') {
      let x = Number(amount)
      if (Number.isFinite(x)) {
        x = Math.max(0, x) * limitAmountDivisor(divisor)
        const floor = BigInt(Math.floor(x))
        const ceil = BigInt(Math.ceil(x))
        result = ceil > defaultValue ? floor : ceil
        if (result >= MAX_INT64) {
          result = MAX_INT64 - 1n
        }
      }
    }
    return result
  }

  function showActions(): void {
    app.showActions()
  }

  function shakeForm(): void {
    const shakingSuffix = ' shaking-block'
    const origClassName = shakingElement.className
    if (!origClassName.endsWith(shakingSuffix)) {
      shakingElement.className += shakingSuffix
      setTimeout(() => { shakingElement && (shakingElement.className = origClassName) }, 1000)
    }
  }

  function enableExchanges(): void {
    invalidMinPrincipalUnitAmount = undefined
    invalidMaxPrincipalUnitAmount = undefined
    if (typeof minPrincipalUnitAmount !== 'number' && typeof minPrincipalUnitAmount !== 'string') {
      minPrincipalUnitAmount = ''
    }
    if (typeof maxPrincipalUnitAmount !== 'number' && typeof maxPrincipalUnitAmount !== 'string') {
      maxPrincipalUnitAmount = ''
    }
  }

  function cancel(): void {
    app.startInteraction()
    actionManager.remove(model.backToAccount)
  }

  function modify(): void {
    app.startInteraction()
    if (invalid) {
      shakeForm()
    } else if (requirePin) {
      openEnterPinDialog = true
    } else {
      submit()
    }
  }

  function submit(pin?: string): void {
    app.executeUpdatePolicyAction(actionManager, accountData.exchange.latestUpdateId, pin, model.backToAccount)
  }

  $: action = model.action
  $: accountData = model.accountData
  $: debtorData = accountData.debtorData
  $: pegBounds = accountData.pegBounds
  $: amount = calcExampleAmount(pegBounds)
  $: display = accountData.display
  $: knownDebtor = display.knownDebtor
  $: amountDivisor = display.amountDivisor
  $: decimalPlaces = display.decimalPlaces
  $: debtorName = display.debtorName
  $: unit = display.unit ?? '\u00A4'
  $: amountSuffix = unit.slice(0, 10)
  $: tinyNegligibleAmount = calcSmallestDisplayableNumber(amountDivisor, decimalPlaces)
  $: unitAmountStep = formatAsUnitAmount(tinyNegligibleAmount, amountDivisor, decimalPlaces)
  $: pegStatus = model.pegStatus
  $: isTheBaseCurrency = debtorData.latestDebtorInfo.uri === appConfig.baseDebtorInfoLocator
  $: minPrincipal = amountToBigint(minPrincipalUnitAmount, amountDivisor, MIN_INT64)
  $: maxPrincipal = amountToBigint(maxPrincipalUnitAmount, amountDivisor, MAX_INT64)
  $: erroneousMaxPrincipleUnitAmount = invalidMaxPrincipalUnitAmount || maxPrincipal < minPrincipal
  $: removeNonstandardPeg = !useNonstandardPeg
  $: requirePin = (
    removeNonstandardPeg ||
    (accountData.exchange.policy ?? '') !== policy ||
    accountData.exchange.minPrincipal !== minPrincipal ||
    accountData.exchange.maxPrincipal !== maxPrincipal
  )
  $: invalid = policy !== '' && (invalidMinPrincipalUnitAmount || erroneousMaxPrincipleUnitAmount)
</script>

<style>
  .radio-group > :global(*) {
    margin: 0.4em 0.2em 0 0.2em;
  }
  .fab-container {
    margin: 16px 16px;
  }
  .shaking-container {
    position: relative;
    overflow: hidden;
  }
  .warning {
    margin: 10px 0;
  }
  strong {
    font-size: 1.1em;
    font-weight: bold;
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
  <Page title="Modify policy" hideFloating={openEnterPinDialog}>
    <svelte:fragment slot="content">
      <EnterPinDialog bind:open={openEnterPinDialog} performAction={submit} />

      <div bind:this={shakingElement}>
        <form
          noValidate
          autoComplete="off"
          on:input={() => actionManager.markDirty()}
          on:input={() => model.goBack = showActions}
          on:change={() => actionManager.save()}
          >
          <LayoutGrid>
            <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
              <AccountInfo
                homepage={debtorData.debtorHomepage?.uri}
                summary={debtorData.summary}
                pegBounds={amount > 0n ? pegBounds : []}
                {amount}
                >
                <svelte:fragment slot="title">
                  {#if knownDebtor}
                    Exchange policy for "{debtorName}"
                  {:else}
                    Exchange policy for "{debtorName}" (unconfirmed account)
                  {/if}
                </svelte:fragment>
              </AccountInfo>
            </Cell>

            {#if pegStatus === 'UsesNonstandardPeg'}
              <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                <FormField style="margin-bottom: 12px">
                  <Checkbox bind:checked={useNonstandardPeg} />
                  <span slot="label">
                    Use a nonstandard currency peg.
                  </span>
                </FormField>
              </Cell>
            {/if}

            {#if pegStatus === 'IgnoresDeclaredPeg'}
              <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                <FormField style="margin-bottom: 12px">
                  <Checkbox bind:checked={ignoreDeclaredPeg} />
                  <span slot="label">
                    Ignore the currency peg declared by the issuer.
                  </span>
                </FormField>
              </Cell>
            {/if}

            {#if pegStatus === 'UsesStandardPeg'}
              <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                <FormField style="margin-bottom: 12px">
                  <Checkbox bind:checked={reviseApprovedPeg} />
                  <span slot="label">
                    Revise the already approved currency peg.
                  </span>
                </FormField>
              </Cell>
            {/if}

            <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
              <div class="radio-group">
                <FormField>
                  <Radio
                    bind:group={policy}
                    value=""
                    touch
                    />
                  <span slot="label">
                    Do not allow
                    {#if appConfig.understandAutomatedExchangesUrl}
                      <a href="{appConfig.understandAutomatedExchangesUrl}" target="_blank" rel="noreferrer">
                        automatic exchanges</a>.
                    {:else}
                      automatic exchanges.
                    {/if}
                  </span>
                </FormField>
                <FormField>
                  <Radio
                    bind:group={policy}
                    on:click={enableExchanges}
                    value="conservative"
                    touch
                    />
                  <span slot="label">
                    Allow automatic buying and selling of this
                    currency to keep the available amount within the
                    defined limits, if possible.
                    {#if appConfig.exchangeFee}
                      Transaction fee: {appConfig.exchangeFee.toLocaleString(undefined, {maximumSignificantDigits: 3})}%.
                    {/if}
                  </span>
                </FormField>
              </div>
            </Cell>
          </LayoutGrid>

          <div style="height: 400px; margin-top: -12px">
            {#if policy !== ''}
              <div in:slide|local={{ duration }} out:slide|local={{ duration }}>
                <LayoutGrid>
                  {#if !isTheBaseCurrency }
                    {#if pegStatus === 'UsesNoPeg' }
                      <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                        <p class="warning">
                          <strong>Important note:</strong> Automatic
                          exchanges are not available for this
                          currency because the issuer has not declared
                          a currency peg.
                        </p>
                      </Cell>
                    {/if}
                    {#if pegStatus === 'UsesNonstandardPeg' }
                      <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                        <p class="warning">
                          <strong>Important note:</strong> Automatic
                          exchanges might not be available for this
                          currency because you have approved a
                          currency peg that differs from the peg
                          declared by the issuer.
                        </p>
                      </Cell>
                    {/if}
                    {#if pegStatus === 'IgnoresDeclaredPeg' }
                      <Cell spanDevices={{ desktop: 12, tablet: 8, phone: 4 }}>
                        <p class="warning">
                          <strong>Important note:</strong> Automatic
                          exchanges are not available for this
                          currency because you have not approved the
                          currency peg declared by its issuer.
                        </p>
                      </Cell>
                    {/if}
                  {/if}
                  <Cell spanDevices={{ desktop: 6, tablet: 4, phone: 4 }}>
                    <Textfield
                      required
                      variant="outlined"
                      type="number"
                      input$min={0}
                      input$step={unitAmountStep}
                      style="width: 100%"
                      withTrailingIcon={invalidMinPrincipalUnitAmount}
                      bind:value={minPrincipalUnitAmount}
                      bind:invalid={invalidMinPrincipalUnitAmount}
                      label="Minumum amount"
                      suffix="{amountSuffix}"
                      >
                      <svelte:fragment slot="trailingIcon">
                        {#if invalidMinPrincipalUnitAmount}
                          <TextfieldIcon class="material-icons">error</TextfieldIcon>
                        {/if}
                      </svelte:fragment>
                      <HelperText slot="helper" persistent>
                        The available amount should not fall below
                        this value. This limit applies only to
                        automatic exchanges and will be enforced on a
                        "best effort" basis.
                      </HelperText>
                    </Textfield>
                  </Cell>

                  <Cell spanDevices={{ desktop: 6, tablet: 4, phone: 4 }}>
                    <Textfield
                      required
                      variant="outlined"
                      type="number"
                      input$min={0}
                      input$step={unitAmountStep}
                      style="width: 100%"
                      withTrailingIcon={erroneousMaxPrincipleUnitAmount}
                      bind:value={maxPrincipalUnitAmount}
                      bind:invalid={invalidMaxPrincipalUnitAmount}
                      label="Maximum amount"
                      suffix="{amountSuffix}"
                      >
                      <svelte:fragment slot="trailingIcon">
                        {#if erroneousMaxPrincipleUnitAmount}
                          <TextfieldIcon class="material-icons">error</TextfieldIcon>
                        {/if}
                      </svelte:fragment>
                      <HelperText slot="helper" persistent>
                        The available amount should not exceed this
                        value. This limit applies only to automatic
                        exchanges and will be enforced on a "best
                        effort" basis. The value must be greater than
                        or equal to the "Minimum amount" value.
                      </HelperText>
                    </Textfield>
                  </Cell>
                </LayoutGrid>
              </div>
            {/if}
          </div>
        </form>
      </div>
    </svelte:fragment>

    <svelte:fragment slot="floating">
      <div class="fab-container">
        <Fab on:click={cancel} extended>
          <Label>Cancel</Label>
        </Fab>
      </div>
      <div class="fab-container">
        <Fab color="primary" on:click={modify} extended>
          <Label>Modify</Label>
        </Fab>
      </div>
    </svelte:fragment>
  </Page>
</div>
