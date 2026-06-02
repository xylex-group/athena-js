import type {
  AthenaAuthEmailTemplateBuilder,
  AthenaAuthEmailTemplateCreateFromDefinitionInput,
  AthenaAuthEmailTemplateDefinition,
  AthenaAuthEmailTemplateUpdateFromDefinitionInput,
  AthenaAuthLooseRecord,
  AthenaAuthReactEmailComponent,
  AthenaAuthReactEmailConfig,
  AthenaAuthReactEmailEventPhase,
  AthenaAuthReactEmailProps,
  AthenaAuthReactEmailRenderEvent,
  AthenaAuthReactEmailRenderInput,
  AthenaAuthReactEmailRenderOptions,
} from './types.ts'

type ReactEmailRenderModule = {
  render: (element: unknown) => string | Promise<string>
  toPlainText?: (html: string) => string | Promise<string>
  pretty?: (html: string) => string | Promise<string>
}

export interface AthenaAuthRenderedReactEmail {
  html: string
  text?: string
}

export interface AthenaAuthReactEmailPayload {
  react?: AthenaAuthReactEmailRenderInput
}

export interface AthenaAuthReactEmailRuntimeOptions {
  route?: string
  defaults?: AthenaAuthReactEmailRenderOptions
  observe?: (event: AthenaAuthReactEmailRenderEvent) => void
}

interface ResolvePayloadFieldsInput {
  htmlField: string
  textField: string
  variablesField?: string
}

let reactEmailRenderModulePromise: Promise<ReactEmailRenderModule> | undefined

function isRecord(value: unknown): value is AthenaAuthLooseRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isFunction(value: unknown): value is (...args: unknown[]) => unknown {
  return typeof value === 'function'
}

function toStringOrUndefined(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  return value
}

function nowIsoString() {
  return new Date().toISOString()
}

function emitReactEmailEvent(
  observe: ((event: AthenaAuthReactEmailRenderEvent) => void) | undefined,
  phase: AthenaAuthReactEmailEventPhase,
  input: Omit<AthenaAuthReactEmailRenderEvent, 'phase' | 'timestamp'> = {},
) {
  if (!observe) return
  try {
    observe({
      phase,
      timestamp: nowIsoString(),
      ...input,
    })
  } catch {
    // Observability hooks are non-blocking.
  }
}

function mergeRenderDefaults(
  input: AthenaAuthReactEmailRenderInput,
  defaults?: AthenaAuthReactEmailRenderOptions,
): AthenaAuthReactEmailRenderInput {
  return {
    ...input,
    pretty: input.pretty ?? defaults?.pretty,
    includePlainText: input.includePlainText ?? defaults?.includePlainText,
  }
}

function mergeRuntimeOptions(
  options?: AthenaAuthReactEmailRuntimeOptions | AthenaAuthReactEmailConfig,
): AthenaAuthReactEmailRuntimeOptions | undefined {
  if (!options) return undefined
  return {
    defaults: options.defaults,
    observe: options.observe,
    route: 'route' in options ? options.route : undefined,
  }
}

async function resolveReactEmailRenderModule(): Promise<ReactEmailRenderModule> {
  if (!reactEmailRenderModulePromise) {
    reactEmailRenderModulePromise = (async () => {
      try {
        const loaded = await import('@react-email/render')
        if (!isFunction(loaded.render)) {
          throw new Error('missing render(...) export')
        }
        return {
          render: loaded.render as ReactEmailRenderModule['render'],
          toPlainText: isFunction(loaded.toPlainText)
            ? (loaded.toPlainText as ReactEmailRenderModule['toPlainText'])
            : undefined,
          pretty: isFunction(loaded.pretty)
            ? (loaded.pretty as ReactEmailRenderModule['pretty'])
            : undefined,
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        throw new Error(
          `React Email rendering requires @react-email/render. Install it in your project (for example: pnpm add @react-email/render). Loader error: ${message}`,
        )
      }
    })()
  }

  if (!reactEmailRenderModulePromise) {
    throw new Error('React Email renderer module failed to initialize')
  }

  return reactEmailRenderModulePromise
}

async function resolveReactEmailElement(input: AthenaAuthReactEmailRenderInput): Promise<unknown> {
  if (input.element != null) {
    return input.element
  }
  if (!input.component) {
    throw new Error('react email payload requires either `element` or `component`')
  }

  try {
    const reactModule = await import('react')
    if (typeof reactModule.createElement !== 'function') {
      throw new Error('react createElement(...) export is unavailable')
    }
    return reactModule.createElement(
      input.component as Parameters<typeof reactModule.createElement>[0],
      input.props ?? {},
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `React Email component rendering requires react runtime support. Install react in your project. Loader error: ${message}`,
    )
  }
}

export function createAuthReactEmailInput<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
>(
  component: AthenaAuthReactEmailComponent<TProps>,
  props: TProps,
  overrides: Omit<AthenaAuthReactEmailRenderInput, 'component' | 'props' | 'element'> = {},
): AthenaAuthReactEmailRenderInput {
  return {
    ...overrides,
    component: component as AthenaAuthReactEmailComponent,
    props,
  }
}

export function defineAuthEmailTemplate<
  TProps extends AthenaAuthReactEmailProps = AthenaAuthReactEmailProps,
>(
  definition: AthenaAuthEmailTemplateDefinition<TProps>,
): AthenaAuthEmailTemplateBuilder<TProps> {
  const react: AthenaAuthEmailTemplateBuilder<TProps>['react'] = (props, overrides) =>
    createAuthReactEmailInput(definition.component, props, {
      ...definition.defaults,
      ...overrides,
    })

  return {
    component: definition.component,
    react,
    toTemplateCreate: (input: AthenaAuthEmailTemplateCreateFromDefinitionInput<TProps>) => {
      const templateKey = input.templateKey ?? definition.templateKey
      const subjectTemplate = input.subjectTemplate ?? definition.subjectTemplate
      if (!templateKey) {
        throw new Error('defineAuthEmailTemplate.toTemplateCreate requires templateKey')
      }
      if (!subjectTemplate) {
        throw new Error('defineAuthEmailTemplate.toTemplateCreate requires subjectTemplate')
      }

      const { props, react: reactOverrides, ...rest } = input
      return {
        ...rest,
        templateKey,
        subjectTemplate,
        react: react(props, reactOverrides),
      }
    },
    toTemplateUpdate: (input: AthenaAuthEmailTemplateUpdateFromDefinitionInput<TProps>) => {
      const { props, react: reactOverrides, ...rest } = input
      return {
        ...rest,
        react: react(props, reactOverrides),
      }
    },
  }
}

export async function renderAthenaReactEmail(
  input: AthenaAuthReactEmailRenderInput,
  options?: AthenaAuthReactEmailRuntimeOptions | AthenaAuthReactEmailConfig,
): Promise<AthenaAuthRenderedReactEmail> {
  if (!isRecord(input)) {
    throw new Error('react email payload must be an object')
  }

  const runtimeOptions = mergeRuntimeOptions(options)
  const start = Date.now()
  emitReactEmailEvent(runtimeOptions?.observe, 'render:start', {
    route: runtimeOptions?.route,
    message: 'Rendering react email payload',
  })

  try {
    const normalizedInput = mergeRenderDefaults(input, runtimeOptions?.defaults)
    const element = await resolveReactEmailElement(normalizedInput)
    const renderModule = await resolveReactEmailRenderModule()
    const htmlValue = await renderModule.render(element)
    const renderedHtml = typeof htmlValue === 'string' ? htmlValue : String(htmlValue ?? '')
    if (!renderedHtml.trim()) {
      throw new Error('react email renderer returned an empty HTML string')
    }

    let html = renderedHtml
    if (normalizedInput.pretty && renderModule.pretty) {
      const prettyValue = await renderModule.pretty(renderedHtml)
      if (typeof prettyValue === 'string' && prettyValue.trim().length > 0) {
        html = prettyValue
      }
    }

    const explicitText = toStringOrUndefined(normalizedInput.text)
    if (explicitText !== undefined) {
      emitReactEmailEvent(runtimeOptions?.observe, 'render:success', {
        route: runtimeOptions?.route,
        durationMs: Date.now() - start,
        message: 'Rendered react email with explicit text',
      })
      return {
        html,
        text: explicitText,
      }
    }

    if (normalizedInput.includePlainText === false || !renderModule.toPlainText) {
      emitReactEmailEvent(runtimeOptions?.observe, 'render:success', {
        route: runtimeOptions?.route,
        durationMs: Date.now() - start,
        message: 'Rendered react email without plain-text derivation',
      })
      return { html }
    }

    const plainTextValue = await renderModule.toPlainText(html)
    const plainText = toStringOrUndefined(plainTextValue)
    emitReactEmailEvent(runtimeOptions?.observe, 'render:success', {
      route: runtimeOptions?.route,
      durationMs: Date.now() - start,
      message: plainText ? 'Rendered react email with derived plain text' : 'Rendered react email HTML only',
    })
    if (plainText === undefined) {
      return { html }
    }

    return {
      html,
      text: plainText,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    emitReactEmailEvent(runtimeOptions?.observe, 'render:error', {
      route: runtimeOptions?.route,
      durationMs: Date.now() - start,
      error: message,
      message: 'Failed to render react email payload',
    })
    throw error
  }
}

export async function resolveReactEmailPayloadFields<
  TInput extends AthenaAuthReactEmailPayload,
>(
  input: TInput,
  fields: ResolvePayloadFieldsInput,
  options?: AthenaAuthReactEmailRuntimeOptions | AthenaAuthReactEmailConfig,
): Promise<Omit<TInput, 'react'>> {
  const { react, ...payloadWithoutReact } = input
  if (!react) {
    return payloadWithoutReact as Omit<TInput, 'react'>
  }

  const rendered = await renderAthenaReactEmail(react, options)
  const payload: AthenaAuthLooseRecord = {
    ...(payloadWithoutReact as AthenaAuthLooseRecord),
  }

  payload[fields.htmlField] = rendered.html

  const currentTextValue = payload[fields.textField]
  if (
    rendered.text !== undefined &&
    (currentTextValue === undefined || currentTextValue === null || currentTextValue === '')
  ) {
    payload[fields.textField] = rendered.text
  }

  if (
    fields.variablesField &&
    (payload[fields.variablesField] === undefined || payload[fields.variablesField] === null) &&
    isRecord(react.props)
  ) {
    const derivedVariables = Object.keys(react.props)
    if (derivedVariables.length > 0) {
      payload[fields.variablesField] = derivedVariables
    }
  }

  return payload as Omit<TInput, 'react'>
}
