<script setup>
// TODO: PHONE LOGIN NEXT
// TODO:  Cannot click "Add Organization" or "Join Organization" because of generateShortId error
import { computed, defineProps, inject, onMounted, reactive } from 'vue'
import { useRoute, useRouter } from 'vue-router'

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
  form: false,
  form2: false,
  provider: 0,
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

const onSubmit = async (event) => {
  state.registering = true
  const results = await event
  if (results.valid) {
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
      console.log('registering')
      const result = await edgeFirebase.registerUser(register, state.provider)
      state.error.error = !result.success
      if (result.message === 'Organization ID already exists.') {
        let orgLabel = props.requestedOrgIdLabel
        if (!orgLabel) {
          orgLabel = props.title
        }
        result.message = `${orgLabel} already exists. Please choose another.`
      }
      state.error.message = result.message.code ? result.message.code : result.message
    }
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
const phoneRegister = async (event) => {
  const results = await event
  if (results.valid) {
    const result = await edgeFirebase.registerUser(register, state.provider)
    state.error.error = !result.success
    state.error.message = result.message.code
  }
  state.phoneConfirmDialog = false
}
function validateInput(event) {
  const pattern = /^(?!.*__)[a-zA-Z0-9_]*$/
  const testString = event.target.value + event.key
  if (!pattern.test(testString)) {
    event.preventDefault()
  }
}
</script>

<template>
  <edge-logging-in v-if="edgeFirebase.user.loggingIn || edgeFirebase.user.loggedIn" />
  <v-card
    v-else
    class="mx-auto px-6 py-8"
    max-width="444"
    title="User Registration"
  >
    <v-form
      v-model="state.form"
      validate-on="submit"
      @submit.prevent="onSubmit"
    >
      <v-container>
        <span v-if="multipleProviders">Choose a login method:</span>
        <v-item-group v-if="multipleProviders" v-model="state.provider" mandatory>
          <Separator
            v-if="props.providers.includes('email')"
            class="my-2"
          />
          <v-item v-if="props.providers.includes('email')" v-slot="{ selectedClass, toggle }" value="email">
            <v-btn
              :prepend-icon="selectedClass ? 'mdi-check' : ''"
              :class="[selectedClass ? 'bg-primary' : 'bg-grey']"
              block
              @click="toggle"
            >
              Username and Password
            </v-btn>
          </v-item>
          <Separator
            v-if="props.providers.includes('emailLink')"
            class="my-2"
          />
          <v-item v-if="props.providers.includes('emailLink')" v-slot="{ selectedClass, toggle }" value="emailLink">
            <v-btn
              :prepend-icon="selectedClass ? 'mdi-check' : ''"
              :class="[selectedClass ? 'bg-primary' : 'bg-grey']"
              block
              @click="toggle"
            >
              Email Link
            </v-btn>
          </v-item>
          <Separator
            v-if="props.providers.includes('microsoft')"
            class="my-2"
          />
          <v-item v-if="props.providers.includes('microsoft')" v-slot="{ selectedClass, toggle }" value="microsoft">
            <v-btn
              :prepend-icon="selectedClass ? 'mdi-check' : ''"
              :class="[selectedClass ? 'bg-primary' : 'bg-grey']"
              block
              @click="toggle"
            >
              Microsoft
            </v-btn>
          </v-item>
          <Separator
            class="my-2"
          />
          <v-item v-if="props.providers.includes('phone')" v-slot="{ selectedClass, toggle }" value="phone">
            <v-btn
              :prepend-icon="selectedClass ? 'mdi-check' : ''"
              :class="[selectedClass ? 'bg-primary' : 'bg-grey']"
              block
              @click="toggle"
            >
              Phone
            </v-btn>
          </v-item>
          <Separator
            v-if="props.providers.includes('phone')"
            class="my-2"
          />
        </v-item-group>
        <v-text-field
          v-if="state.provider === 'email' || state.provider === 'emailLink'"
          v-model="register.email"
          :rules="[edgeGlobal.edgeRules.email]"
          class="mb-2"
          label="Email"
          variant="underlined"
        />

        <v-text-field
          v-if="state.provider === 'email'"
          v-model="register.password"
          :rules="[edgeGlobal.edgeRules.password]"
          :append-inner-icon="state.passwordShow ? 'mdi-eye' : 'mdi-eye-off'"
          :type="state.passwordShow ? 'text' : 'password'"
          label="Password"
          placeholder="Enter your password"
          variant="underlined"
          @click:append-inner="state.passwordShow = !state.passwordShow"
        />

        <edge-g-input
          v-if="state.provider === 'phone'"
          v-model="state.phone"
          :disable-tracking="true"
          field-type="text"
          :rules="[edgeGlobal.edgeRules.required]"
          label="Phone Number"
          :mask-options="{ mask: '(###) ###-####' }"
        />

        <v-text-field
          v-model="register.meta.name"
          :rules="[edgeGlobal.edgeRules.required]"
          label="Name"
          variant="underlined"
        />
        <v-text-field
          v-if="props.showRequestedOrgId"
          v-model="register.requestedOrgId"
          :rules="[edgeGlobal.edgeRules.required]"

          :label="props.requestedOrgIdLabel"
          variant="underlined"
          hint="Once submitted, this cannot be changed. Only use letters, numbers, and underscores."
          @keypress="validateInput"
        />

        <v-checkbox
          v-if="!props.singleOrganization && props.registrationCode"
          v-model="state.showRegistrationCode"
          class="my-0"
          hide-details
        >
          <template #label>
            <span class="ml-2">{{ props.joinMessage }}</span>
          </template>
        </v-checkbox>
        <template v-if="!props.singleOrganization">
          <v-text-field
            v-if="state.showRegistrationCode || !props.registrationCode"
            v-model="state.registrationCode"
            :rules="[edgeGlobal.edgeRules.required]"
            label="Registration Code"
            variant="underlined"
          />
          <v-text-field
            v-else
            v-model="register.dynamicDocumentFieldValue"
            :rules="[edgeGlobal.edgeRules.required]"
            :label="props.title"
            variant="underlined"
          />
        </template>

        <v-checkbox
          v-model="state.terms"
          :rules="[edgeGlobal.edgeRules.required]"
          label="I agree to site terms and conditions"
        />
        <v-btn v-if="props.termsLinks" class="mt-0" variant="text" block text small :href="props.termsLinks" target="_blank">
          Terms and Conditions
        </v-btn>
      </v-container>

      <Separator />

      <v-card-actions>
        <v-spacer />

        <v-btn color="success" :loading="state.registering" type="submit">
          Submit
        </v-btn>
      </v-card-actions>
      <edge-g-error v-if="edgeFirebase.user.logInError" :error="edgeFirebase.user.logInErrorMessage" />
      <edge-g-error v-if="state.error.error" :error="state.error.message" />
      <Separator class="py-4" />
      Already have an account?
      <v-btn color="success" small block to="/app/login">
        Sign in here.
      </v-btn>
    </v-form>
    <v-dialog
      v-model="state.phoneConfirmDialog"
      persistent
      max-width="600"
      transition="fade-transition"
    >
      <v-card>
        <v-form

          v-model="state.form2"
          validate-on="submit"
          @submit.prevent="phoneRegister"
        >
          <v-toolbar flat>
            <v-icon class="mx-4">
              mdi-list-box
            </v-icon>
            Enter Confirmation Code
            <v-spacer />

            <v-btn
              type="submit"
              icon
              @click="state.phoneConfirmDialog = false"
            >
              <v-icon> mdi-close</v-icon>
            </v-btn>
          </v-toolbar>
          <v-card-title>Enter Confirmation Code</v-card-title>
          <v-card-text>
            Please enter the confirmation code that you received via text message. This code is used to verify your phone number. If you did not receive a text message, please confirm that your phone number is correct and request a new code.
            <v-text-field
              v-model="register.phoneCode"
              :rules="[edgeGlobal.edgeRules.required]"
              label="Confirmation Code"
              variant="underlined"
            />
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              @click="state.phoneConfirmDialog = false"
            >
              Cancel
            </v-btn>
            <v-btn
              type="submit"
              color="error"
              variant="text"
            >
              Submit
            </v-btn>
          </v-card-actions>
        </v-form>
      </v-card>
    </v-dialog>
  </v-card>
</template>
