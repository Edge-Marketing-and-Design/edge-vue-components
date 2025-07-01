<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  registrationCode: {
    type: String,
    default: '',
  },
  providers: {
    type: Array,
    default: () => ['email', 'microsoft'],
  },
  title: {
    type: String,
    default: 'Organization',
  },
  joinMessage: {
    type: String,
    default: 'Join an existing organization',
  },
  termsLinks: {
    type: String,
    default: '',
  },
  singleOrganization: {
    type: Boolean,
    default: false,
  },
  showRequestedOrgId: {
    type: Boolean,
    default: false,
  },
  requestedOrgIdLabel: {
    type: String,
    default: '',
  },
  primaryButtonClasses: {
    type: String,
    required: false,
  },
  secondaryButtonClasses: {
    type: String,
    reactive: false,
  },
})

const multipleProviders = computed(() => props.providers.length > 1)

const router = useRouter()

const route = useRoute()
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  registering: false,
  passwordVisible: false,
  passwordShow: false,
  terms: false,
  form: true,
  provider: '',
  error: { error: false, message: '' },
  registrationCode: '',
  showRegistrationCode: false,
  phone: '',
  phoneConfirmDialog: false,
})

const register = reactive({
  meta: { name: '' },
  email: '',
  password: '',
  registrationCode: props.registrationCode, // TODO - This should come from .env since it will be different on production
  dynamicDocumentFieldValue: '',
  phoneNumber: null,
  phoneCode: '',
  requestedOrgId: '',
})

const onSubmit = async () => {
  state.registering = true

  if (props.singleOrganization) {
    register.dynamicDocumentFieldValue = register.meta.name
  }
  if (state.provider === 'phone') {
    register.phoneNumber = await edgeFirebase.sendPhoneCode(`${state.phone}`)
    if (register.phoneNumber !== false) {
      state.phoneConfirmDialog = true
    }
  }
  else if (state.provider === 'emailLink') {
    const flattenRegister = {
      ...state,
      ...register,
      ...register.meta,
    }
    delete flattenRegister.meta
    delete flattenRegister.error

    const queryString = Object.keys(flattenRegister).map(key => `${key}=${encodeURIComponent(flattenRegister[key])}`).join('&')
    const url = `/app/signup?${queryString}`
    router.push(url)

    // state.phoneConfirmDialog = true
  }
  else {
    if (state.showRegistrationCode || !props.registrationCode) {
      register.registrationCode = state.registrationCode
    }
    const result = await edgeFirebase.registerUser(register, state.provider)
    state.error.error = !result.success
    if (result.message === `${props.requestedOrgIdLabel} already exists.`) {
      let orgLabel = props.requestedOrgIdLabel
      if (!orgLabel) {
        orgLabel = props.title
      }
      result.message = `${orgLabel} already exists. Please choose another.`
    }
    state.error.message = result.message.code ? result.message.code : result.message
  }

  state.registering = false
}
onMounted(() => {
  state.provider = props.providers[0]
  const regCode = route.query['reg-code'] ? route.query['reg-code'] : ''
  state.registrationCode = regCode
  if (regCode) {
    state.showRegistrationCode = true
  }
})

const phoneRegister = async () => {
  const result = await edgeFirebase.registerUser(register, state.provider)
  state.error.error = !result.success
  state.error.message = result.message.code
  state.phoneConfirmDialog = false
}

const providerNames = {
  email: 'With email and password',
  phone: 'With phone number',
  emailLink: 'With email link',
  microsoft: 'With Microsoft',
}

const phoneCodeSchema = toTypedSchema(z.object({
  phoneCode: z.string({
    required_error: 'Confirmation code is required',
  }).min(1, { message: 'Confirmation code is required' }),
}))

const schema = computed(() => {
  const baseSchema = {
    name: z.string({
      required_error: 'Name is required',
    }).min(1, { message: 'Registration code is required' }),
    terms: z.boolean({
      required_error: 'You must agree to the terms and conditions',
    }).refine(value => value, {
      message: 'You must agree to the terms and conditions',
    }),
  }

  if (state.provider === 'email') {
    const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,50}$/

    baseSchema.email = z.string({
      required_error: 'Email is required',
    })
      .email({ message: 'Invalid email address' })
      .min(6, { message: 'Email must be at least 6 characters long' })
      .max(50, { message: 'Email must be less than 50 characters long' })

    baseSchema.password = z.string({
      required_error: 'Password is required',
    }).superRefine((value, ctx) => {
      if (!passwordPattern.test(value)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
          'Password must be 8–50 characters and include at least one uppercase letter, one lowercase letter, one number, and one special character (e.g., !@#$%^&*).',
        })
      }
    })
  }

  if (props.showRequestedOrgId) {
    baseSchema.requestedOrgId = z.string({
      required_error: `${props.requestedOrgIdLabel} is required`,
    }).min(1, { message: `${props.requestedOrgIdLabel} is required` })
  }

  if (state.provider === 'phone') {
    baseSchema.phone = z.string({
      required_error: 'Phone number is required',
    }).min(14, { message: 'Not a valid phone number' }).max(14, { message: 'Not a valid phone number' })
  }

  if (state.showRegistrationCode || !props.registrationCode) {
    baseSchema.registrationCode = z.string({
      required_error: 'Registration code is required',
    }).min(1, { message: 'Registration code is required' })
  }

  if (!state.showRegistrationCode) {
    if (!props.singleOrganization) {
      baseSchema.dynamicDocumentFieldValue = z.string({
        required_error: `${props.title} is required`,
      }).min(1, { message: `${props.title} is required` })
    }
  }

  return toTypedSchema(z.object(baseSchema))
})

watch(schema, async () => {
  state.terms = false
  state.form = false
  await nextTick()
  state.form = true
})

const customMaskOptions = {
  mask(value) {
    const pattern = /^[a-zA-Z0-9_]*$/
    return value.split('').filter(char => pattern.test(char)).join('')
  },
}
</script>

<template>
  <edge-logging-in v-if="edgeFirebase.user.loggingIn || edgeFirebase.user.loggedIn" />
  <Card v-else class="max-w-md">
    <slot />
    <CardContent>
      <span v-if="multipleProviders">Choose a login method:</span>
      <div v-if="multipleProviders">
        <template v-for="provider in props.providers" :key="provider">
          <edge-shad-button :class="props.secondaryButtonClasses" @click="state.provider = provider">
            <Check v-if="state.provider === provider" class="w-4 h-4 mr-2" />
            {{ providerNames[provider] }}
          </edge-shad-button>
          <Separator
            class="my-2 dark:bg-slate-600"
          />
        </template>
      </div>
      <edge-shad-form
        v-if="state.form"
        :schema="schema"
        @submit="onSubmit"
      >
        <div class="grid gap-4">
          <div class="grid gap-2">
            <edge-shad-input
              v-if="state.provider === 'email'"
              v-model="register.email"
              name="email"
              type="email"
              label="Email"
              placeholder="m@example.com"
            />
          </div>
          <div class="grid gap-2">
            <edge-shad-input
              v-if="state.provider === 'email'"
              v-model="register.password"
              name="password"
              type="password"
              label="Password"
            />
          </div>
          <div class="grid gap-2">
            <edge-shad-input
              v-if="state.provider === 'phone'"
              v-model="state.phone"
              name="phone"
              type="tel"
              label="Phone Number"
              placeholder="(555) 555-5555"
              :mask-options="{ mask: '(###) ###-####' }"
            />
          </div>
          <div class="grid gap-2">
            <edge-shad-input
              v-model="register.meta.name"
              name="name"
              type="text"
              label="Name"
            />
          </div>
          <edge-shad-input
            v-if="props.showRequestedOrgId"
            v-model="register.requestedOrgId"
            :label="props.requestedOrgIdLabel"
            name="requestedOrgId"
            type="text"
            description="Once submitted, this cannot be changed. Only use letters, numbers, and underscores."
            :mask-options="customMaskOptions"
          />
          <edge-shad-checkbox
            v-if="!props.singleOrganization"
            v-model="state.showRegistrationCode"
            name="showRegistrationCode"
          >
            {{ props.joinMessage }}
          </edge-shad-checkbox>

          <template v-if="!props.singleOrganization">
            <edge-shad-input
              v-if="state.showRegistrationCode || !props.registrationCode"
              v-model="state.registrationCode"
              label="Registration Code"
              name="registrationCode"
            />
            <edge-shad-input
              v-else
              v-model="register.dynamicDocumentFieldValue"
              :label="props.title"
              name="dynamicDocumentFieldValue"
            />
          </template>
          <edge-shad-input
            v-if="!props.registrationCode"
            v-model="state.registrationCode"
            label="Registration Code"
            name="registrationCode"
          />

          <edge-shad-checkbox
            v-model="state.terms"
            name="terms"
          >
            I agree to site <a v-if="props.termsLinks" :href="props.termsLinks" class="mt-0 mx-auto underline hover:no-underline" target="_blank">
              terms and conditions
            </a>
            <span v-else>terms and conditions</span>
          </edge-shad-checkbox>

          <edge-shad-button type="submit" :disabled="state.registering" :class="props.primaryButtonClasses">
            <Loader2 v-if="state.registering" class="w-4 h-4 mr-2 animate-spin" />
            <span v-if="state.registering">Registering...</span>
            <span v-else>Submit</span>
          </edge-shad-button>
        </div>
      </edge-shad-form>
      <edge-g-error v-if="edgeFirebase.user.logInError" :error="edgeFirebase.user.logInErrorMessage" />
      <edge-g-error v-if="state.error.error" :error="state.error.message" />

      <Separator
        class="my-4 dark:bg-slate-600"
      />
      Already have an account?
      <edge-shad-button class="bg-secondary text-secondary-foreground" :class="props.secondaryButtonClasses" to="/app/login">
        Sign in here.
      </edge-shad-button>
      <edge-shad-dialog
        v-model="state.phoneConfirmDialog"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Enter Confirmation Code</DialogTitle>
            <DialogDescription class="text-left mb-2">
              Please enter the confirmation code that you received via text message. This code is used to verify your phone number. If you did not receive a text message, please confirm that your phone number is correct and request a new code.
            </DialogDescription>
          </DialogHeader>
          <edge-shad-form
            :schema="phoneCodeSchema"
            @submit="phoneRegister"
          >
            <edge-shad-input
              v-model="register.phoneCode"
              label="Confirmation Code"
              name="phoneCode"
            />
            <DialogFooter>
              <edge-shad-button variant="destructive" @click="state.phoneConfirmDialog = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button
                type="submit"
                :class="props.primaryButtonClasses"
              >
                Submit
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
        </DialogContent>
      </edge-shad-dialog>
    </CardContent>
  </Card>
</template>
