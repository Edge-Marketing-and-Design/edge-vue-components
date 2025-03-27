<script setup>
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const props = defineProps({
  providers: {
    type: Array,
    default: () => ['email'],
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

const route = useRoute()

const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

const state = reactive({
  form2: false,
  phone: '',
  email: '',
  password: '',
  passwordVisible: false,
  passwordShow: false,
  panel: '',
  phoneConfirmDialog: false,
  phoneNumber: null,
  phoneCode: '',
  forgotPasswordDialog: false,
  passwordResetResult: { success: null, message: '' },
  passwordResetSent: false,
  passwordResetDialog: false,
})

const login = reactive({
  email: '',
  password: '',
})

const sendPhoneCode = async () => {
  state.phoneNumber = await edgeFirebase.sendPhoneCode(`${state.phone}`)
  if (state.phoneNumber !== false) {
    state.phoneConfirmDialog = true
  }
}

const phoneLogin = async () => {
  await edgeFirebase.logInWithPhone(state.phoneNumber, state.phoneCode)
  state.phoneConfirmDialog = false
}

const submitForgotPassword = async () => {
  const result = await edgeFirebase.sendPasswordReset(login.email)
  state.passwordResetResult = result
  state.passwordResetSent = true
}

const resetPassword = async () => {
  let result = null
  if (route.query.mode === 'resetPassword') {
    result = await edgeFirebase.passwordReset(login.password, route.query.oobCode)
  }
  if (route.query.mode !== 'resetPassword') {
    result = await edgeFirebase.emailUpdate(route.query.oobCode)
  }
  state.passwordResetResult = result
}

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

const loginSchema = toTypedSchema(z.object({
  email: z.string().email().min(6).max(50),
  password: z.string().superRefine((value, ctx) => {
    if (value.length < 8 || value.length > 50 || !passwordPattern.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must have at least 8 characters, including uppercase and lowercase letters, numbers, and a special character',
      })
    }
  }),
}))

const emailSchema = toTypedSchema(z.object({
  email: z.string().email().min(6).max(50),
}))

const passwordSchema = toTypedSchema(z.object({
  password: z.string().superRefine((value, ctx) => {
    if (value.length < 8 || value.length > 50 || !passwordPattern.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must have at least 8 characters, including uppercase and lowercase letters, numbers, and a special character',
      })
    }
  }),
}))

const phoneSchema = toTypedSchema(z.object({
  phone: z.string().min(14, 'Not a valid phone number').max(14),
}))

const codeSchema = toTypedSchema(z.object({
  phoneCode: z.string().min(1, 'Not a valid code'),
}))

const onSubmit = async (values) => {
  console.log(state.panel)
  console.log(values)
  await edgeFirebase.logIn(login)
}

const onPhoneSubmit = async (values) => {
  console.log(values)
  await sendPhoneCode()
}

onMounted(async () => {
  state.panel = props.providers[0]
  if (route.query.oobCode) {
    await edgeFirebase.logOut()
    state.passwordResetDialog = true
  }
})

const registerPath = computed(() => {
  const firstPart = route.path.split('/')[1]
  return `/${firstPart}/signup`
})
</script>

<template>
  <edge-logging-in v-if="edgeFirebase.user.loggingIn !== false || edgeFirebase.user.loggedIn" />
  <Card v-else>
    <slot />
    <CardContent>
      <Accordion v-if="state.panel" v-model="state.panel" expand-icon="mdi-square-outline" :default-value="state.panel" collapse-icon="mdi-check">
        <AccordionItem v-for="provider in props.providers" :key="provider" elevation="0" :value="provider">
          <AccordionTrigger class="font-medium text-lg">
            <template v-if="provider === 'email'">
              Sign in with Email
            </template>
            <template v-if="provider === 'microsoft'">
              Sign in with Microsoft
            </template>
            <template v-if="provider === 'phone'">
              Sign in with Phone
            </template>
          </AccordionTrigger>
          <AccordionContent>
            <template v-if="provider === 'email'">
              <edge-shad-form :schema="loginSchema" @submit="onSubmit">
                <div class="grid gap-2 text-center">
                  <p class="text-balance text-muted-foreground">
                    Enter your email below to login to your account
                  </p>
                </div>
                <div class="grid gap-4">
                  <div class="grid gap-2">
                    <edge-shad-input
                      v-model="login.email"
                      name="email"
                      type="email"
                      label="Email"
                      placeholder="m@example.com"
                    />
                  </div>
                  <div class="grid gap-2">
                    <edge-shad-input
                      v-model="login.password"
                      name="password"
                      type="password"
                      label="Password"
                    >
                      <a
                        class="text-sm underline cursor-pointer"
                        @click="state.forgotPasswordDialog = true"
                      >
                        Forgot your password?
                      </a>
                    </edge-shad-input>
                  </div>
                  <edge-shad-button type="submit" :class="props.primaryButtonClasses">
                    Login
                  </edge-shad-button>
                </div>
              </edge-shad-form>
            </template>
            <template v-if="provider === 'phone'">
              <edge-shad-form :schema="phoneSchema" @submit="onPhoneSubmit">
                <edge-shad-input
                  v-model="state.phone"
                  name="phone"
                  type="tel"
                  label="Phone Number"
                  placeholder="(555) 555-5555"
                  :mask-options="{ mask: '(###) ###-####' }"
                  class="mb-4"
                />
                <edge-shad-button type="submit" :class="props.primaryButtonClasses">
                  Login
                </edge-shad-button>
              </edge-shad-form>
            </template>
            <template v-if="provider === 'microsoft'">
              <edge-shad-button :class="props.primaryButtonClasses" @click="edgeFirebase.logInWithMicrosoft()">
                Sign in with Microsoft
              </edge-shad-button>
            </template>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      <edge-g-error v-if="edgeFirebase.user.logInError" :error="edgeFirebase.user.logInErrorMessage" />
      <Separator
        class="my-4 dark:bg-slate-600"
      />
      Don't have an account?
      <edge-shad-button class="bg-secondary text-secondary-foreground" :class="props.secondaryButtonClasses" :to="registerPath">
        Sign up here.
      </edge-shad-button>
      <edge-shad-dialog
        v-model="state.passwordResetDialog"
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              <span v-if="route.query.mode === 'resetPassword'">
                Reset Password

              </span>
              <span v-else>
                Update Email Address
              </span>
            </DialogTitle>
            <DialogDescription class="text-left mb-2">
              <span v-if="route.query.mode === 'resetPassword'" class="mb-2">
                Enter your new password below and click "Reset Password".
              </span>
              <template v-else>
                <p class="mb-2">
                  To update your email address, click "Update Email Address".
                </p>
                <p class="mb-2">
                  This will change your email address to the address that received the email with the link you clicked on to get here.
                </p>
              </template>
            </DialogDescription>
          </DialogHeader>
          <edge-shad-form
            :schema="passwordSchema"
            @submit="resetPassword"
          >
            <edge-shad-input
              v-if="route.query.mode === 'resetPassword'"
              v-model="login.password"
              name="password"
              type="password"
              label="Password"
            />
            <edge-g-error v-if="state.passwordResetResult.success === false" :error="state.passwordResetResult.message" />
            <Alert v-if="state.passwordResetResult.success === true" class="mt-2 bg-green-800">
              <AlertDescription>
                <span v-if="route.query.mode === 'resetPassword'">
                  Your password has been reset. Close this dialog and log in with your new password.
                </span>
                <span v-else>
                  Your email address has been updated. Close this dialog and log in with your updated address.
                </span>
              </AlertDescription>
            </Alert>
            <DialogFooter v-if="route.query.mode === 'resetPassword'" class="flex justify-between pt-6">
              <edge-shad-button v-if="state.passwordResetResult.success === true" variant="destructive" @click="state.passwordResetDialog = false">
                Close
              </edge-shad-button>
              <edge-shad-button v-else variant="destructive" @click="state.passwordResetDialog = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button v-if="state.passwordResetResult.success !== true" :class="props.primaryButtonClasses" type="submit">
                Reset Password
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
          <edge-shad-form
            v-if="route.query.mode !== 'resetPassword'"
            @submit="resetPassword"
          >
            <DialogFooter class="pt-6 flex justify-between">
              <edge-shad-button v-if="state.passwordResetResult.success === true" variant="destructive" @click="state.passwordResetDialog = false">
                Close
              </edge-shad-button>
              <edge-shad-button v-else variant="destructive" @click="state.passwordResetDialog = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button v-if="state.passwordResetResult.success !== true" :class="props.primaryButtonClasses" type="submit">
                Update Email Address
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
        </DialogContent>
      </edge-shad-dialog>

      <edge-shad-dialog
        v-model="state.forgotPasswordDialog"
      >
        <DialogContent>
          <edge-shad-form
            :schema="emailSchema"
            @submit="submitForgotPassword"
          >
            <DialogHeader>
              <DialogTitle>Password Reset</DialogTitle>
              <DialogDescription class="text-left mb-2">
                If you forgot your password, please enter your email address below and click "Send Password Reset".
              </DialogDescription>
            </DialogHeader>
            <edge-shad-input
              v-model="login.email"
              init-valu
              name="email"
              type="email"
              label="Email"
              placeholder="m@example.com"
              class="mb-4"
            />
            <Alert v-if="state.passwordResetSent" class="my-2 bg-green-800">
              <AlertDescription>
                If you entered the correct email address, a password reset email has been sent to your email address. Please check your email and click the link to reset your password.
              </AlertDescription>
            </Alert>
            <DialogFooter class="pt-0 flex justify-between">
              <edge-shad-button v-if="state.passwordResetSent === true" variant="destructive" @click="state.forgotPasswordDialog = false; state.passwordResetSent = false;">
                Close
              </edge-shad-button>
              <edge-shad-button v-else variant="destructive" @click="state.forgotPasswordDialog = false; state.passwordResetSent = false;">
                Cancel
              </edge-shad-button>
              <edge-shad-button v-if="state.passwordResetSent === false" :class="props.primaryButtonClasses" type="submit">
                Send Password Reset
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
        </DialogContent>
      </edge-shad-dialog>
      <edge-shad-dialog
        v-model="state.phoneConfirmDialog"
      >
        <DialogContent>
          <edge-shad-form
            :schema="codeSchema"
            @submit="phoneLogin"
          >
            <DialogHeader>
              <DialogTitle>Enter Confirmation Code</DialogTitle>
              <DialogDescription class="text-left mb-2">
                Please enter the confirmation code that you received via text message. This code is used to verify your phone number. If you did not receive a text message, please confirm that your phone number is correct and request a new code.
              </DialogDescription>
            </DialogHeader>
            <edge-shad-input
              v-model="state.phoneCode"
              name="phoneCode"
              type="text"
              label="Confirmation Code"
            />

            <DialogFooter class="pt-6 flex justify-between">
              <edge-shad-button variant="destructive" @click="state.phoneConfirmDialog = false">
                Cancel
              </edge-shad-button>
              <edge-shad-button :class="props.primaryButtonClasses" type="submit">
                Submit
              </edge-shad-button>
            </DialogFooter>
          </edge-shad-form>
        </DialogContent>
      </edge-shad-dialog>
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>
</style>
