<script setup>
import { computed, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import { Loader2, Save } from 'lucide-vue-next'
import * as z from 'zod'
const edgeFirebase = inject('edgeFirebase')

const router = useRouter()

const state = reactive({
  loading: false,
  username: '',
  newPassword: '',
  oldPassword: '',
  passwordForm: false,
  userForm: false,
  loaded: true,
  passwordVisible: false,
  passwordShow: false,
  passwordError: { success: true, message: '' },
  userError: { success: true, message: '' },
  showDeleteAccount: false,
  deleteForm: false,
})
const updateUser = async () => {
  state.loading = true
  state.userError = await edgeFirebase.updateEmail(state.username)
  if (state.userError.message === 'Firebase: Error (auth/email-already-in-use).') {
    state.userError = { success: false, message: 'Email already in use.' }
  }
  if (state.userError.message === 'Firebase: Error (auth/requires-recent-login).') {
    state.userError = { success: false, message: 'Please log out and log back in to change your email.' }
  }
  state.userError = { success: state.userError.success, message: state.userError.message.replace('Firebase: ', '').replace(' (auth/invalid-email)', '') }
  if (state.userError.success) {
    state.userError = { success: true, message: 'A verification link has been sent to your new email address. Please click the link to complete the email change process.' }
    await edgeFirebase.setUserMeta({ email: state.username })
  }
  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  state.loading = false
  await nextTick()
  state.loaded = true
}
const updatePassword = async () => {
  state.loading = true
  state.passwordError = await edgeFirebase.setPassword(state.oldPassword, state.newPassword)
  if (state.passwordError.message === 'Firebase: Error (auth/wrong-password).') {
    state.passwordError = { success: false, message: 'Old Password is incorrect.' }
  }
  state.passwordError = { success: state.passwordError.success, message: state.passwordError.message.replace('Firebase: ', '').replace(' (auth/weak-password)', '') }
  if (state.passwordError.success) {
    state.oldPassword = ''
    state.newPassword = ''
    state.passwordError = { success: true, message: 'Password successfully changed' }
  }
  edgeGlobal.edgeState.changeTracker = {}
  state.loading = false
  state.loaded = false
  await nextTick()
  state.loaded = true
}
const deleteAccount = async () => {
  state.loading = true
  await edgeFirebase.runFunction('edgeFirebase-deleteSelf', { uid: edgeFirebase.user.uid })
  await edgeFirebase.logOut()
  state.loading = false
  router.push('/app/login')
}

const currentOrgName = computed(() => {
  if (edgeGlobal.objHas(edgeFirebase.data, edgeGlobal.edgeState.organizationDocPath) === false) {
    return ''
  }
  return edgeFirebase.data[edgeGlobal.edgeState.organizationDocPath].name
})
onBeforeMount(() => {
  if (edgeFirebase.user.firebaseUser.providerData.length === 0) {
    state.username = edgeFirebase.user.uid
  }
  else {
    state.username = edgeFirebase.user.firebaseUser.providerData[0].email
  }
})
watch(currentOrgName, async () => {
  state.org = currentOrgName.value
  edgeGlobal.edgeState.changeTracker = {}
  state.loaded = false
  await nextTick()
  state.loaded = true
})

const passwordPattern = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/

const passwordSchema = toTypedSchema(z.object({
  oldPassword: z.string({
    required_error: 'Password is required',
  }).superRefine((value, ctx) => {
    if (value.length < 8 || value.length > 50 || !passwordPattern.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must have at least 8 characters, including uppercase and lowercase letters, numbers, and a special character',
      })
    }
  }),
  newPassword: z.string({
    required_error: 'Password is required',
  }).superRefine((value, ctx) => {
    if (value.length < 8 || value.length > 50 || !passwordPattern.test(value)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Password must have at least 8 characters, including uppercase and lowercase letters, numbers, and a special character',
      })
    }
  }),
}))

const usernameSchema = toTypedSchema(z.object({
  username: z.string({
    required_error: 'Username is required',
  }).email({
    message: 'Invalid email address',
  }),
}))

const deleteSchema = toTypedSchema(z.object({
  delete_account: z.boolean({
    required_error: 'You must confirm that you understand the consequences of deleting your account',
  }),
}))

const accountHeaderTitle = computed(() => String(state.username || edgeFirebase.user?.uid || '').trim() || 'My Account')

const accountHeaderSubtitle = computed(() => {
  const provider = edgeFirebase.user?.firebaseUser?.providerData?.[0]?.providerId
  if (!provider)
    return 'Custom provider'
  return provider === 'password' ? 'Password account' : `Provider: ${provider}`
})
</script>

<template>
  <Card class="mx-auto w-full flex-1 border-none bg-slate-100 pt-0 shadow-none dark:bg-slate-950">
    <slot name="header">
      <div class="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div class="px-6 py-6">
          <div class="text-sm text-slate-500 dark:text-slate-400">
            Account <span class="mx-2 text-slate-300 dark:text-slate-700">/</span>
            <span class="font-medium text-slate-900 dark:text-slate-100">My Account</span>
          </div>
          <div class="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div class="min-w-0">
              <h1 class="line-clamp-2 max-w-5xl text-3xl font-bold leading-tight text-slate-950 dark:text-slate-50 xl:text-4xl">
                {{ accountHeaderTitle }}
              </h1>
              <div class="mt-3 flex flex-wrap items-center gap-3 text-base text-slate-500 dark:text-slate-400">
                <span>{{ accountHeaderSubtitle }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </slot>
    <CardContent v-if="state.loaded" class="scroll-area w-full overflow-y-auto bg-slate-100 p-6 dark:bg-slate-950">
      <Card v-if="state.loaded" class="bg-transparent border-0">
        <CardContent class="space-y-6">
          <template v-if="edgeFirebase.user.firebaseUser.providerData.length === 0">
            <edge-v-alert>
              Logged in as:
              <edge-v-alert-title>{{ state.username }}</edge-v-alert-title>
              <strong>Custom Provider</strong>
              <Separator class="my-4 dark:bg-slate-600" />
              Notice: You're signed in with a custom provider. Nothing to update here.
            </edge-v-alert>
          </template>
          <template v-else-if="edgeFirebase.user.firebaseUser.providerData[0].providerId === 'password'">
            <div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Update Email
              </div>
              <edge-shad-form
                v-model="state.userForm"
                :schema="usernameSchema"
                @submit="updateUser"
              >
                <edge-g-input
                  v-model="state.username"
                  name="username"
                  field-type="text"
                  label="Username"
                  parent-tracker-id="my-account"
                  hint="Update your email address, which also serves as your username."
                  persistent-hint
                />
                <edge-v-alert
                  v-if="state.userError.message !== ''"
                  :type="state.userError.success ? 'success' : 'error'"
                  dismissible
                  class="mt-0 mb-3 text-caption" density="compact" variant="tonal"
                >
                  {{ state.userError.message }}
                </edge-v-alert>

                <edge-shad-button
                  type="submit"
                  :disabled="state.loading"
                  class="h-10 bg-slate-900 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" />
                  <Save v-else class="mr-2 h-4 w-4" />
                  Update Email
                </edge-shad-button>
              </edge-shad-form>
            </div>
            <div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                Change Password
              </div>
              <edge-shad-form
                v-model="state.passwordForm"
                :schema="passwordSchema"
                @submit="updatePassword"
              >
                <edge-shad-input
                  v-model="state.oldPassword"
                  type="password"
                  label="Old Password"
                  placeholder="Enter your old password"
                  name="oldPassword"
                />
                <edge-shad-input
                  v-model="state.newPassword"
                  type="password"
                  label="New Password"
                  placeholder="Enter your new password"
                  name="newPassword"
                />
                <edge-v-alert
                  v-if="state.passwordError.message !== ''"
                  :type="state.passwordError.success ? 'success' : 'error'"
                  dismissible
                  class="mt-0 mb-3 text-caption" density="compact" variant="tonal"
                >
                  {{ state.passwordError.message }}
                </edge-v-alert>
                <edge-shad-button
                  type="submit"
                  :disabled="state.loading"
                  class="h-10 bg-slate-900 px-4 text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-300"
                >
                  <Loader2 v-if="state.loading" class="mr-2 h-4 w-4 animate-spin" />
                  <Save v-else class="mr-2 h-4 w-4" />
                  Update Password
                </edge-shad-button>
              </edge-shad-form>
            </div>
          </template>
          <template v-else>
            <edge-v-alert>
              Logged in as:
              <edge-v-alert-title>{{ edgeFirebase.user.firebaseUser.providerData[0].email }}</edge-v-alert-title>
              <strong>Provider: {{ edgeFirebase.user.firebaseUser.providerData[0].providerId }}</strong>
              <Separator class="my-4 dark:bg-slate-600" />
              Notice: You're signed in with a third-party provider. To update your login information, please visit your provider's account settings. Changes cannot be made directly within this app.
            </edge-v-alert>
          </template>
          <div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div class="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
              Delete Account
            </div>
            <edge-shad-form
              v-model="state.deleteForm"
              :schema="deleteSchema"
              @submit="deleteAccount"
            >
              <edge-shad-button
                v-if="!state.showDeleteAccount"
                :disabled="state.loading"
                variant="destructive"
                class="w-full"
                @click.stop.prevent="state.showDeleteAccount = true"
              >
                <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                Delete Account
              </edge-shad-button>
              <edge-v-alert v-else closable variant="tonal" border="start" type="error" prominent @click:close="state.showDeleteAccount = false">
                <div class="text-xl font-bold">
                  Are you sure?
                </div>
                <h3 class="my-2">
                  <strong>Warning:</strong> Deleting your account will permanently remove all of your data from this app. This action cannot be undone.
                </h3>
                <edge-g-input
                  name="delete_account"
                  field-type="boolean"
                  label="I understand the consequences of deleting my account."
                  :disable-tracking="true"
                />
                <div class="flex gap-2 items-center">
                  <edge-shad-button
                    :disabled="state.loading"
                    variant="outline"
                    class="mt-3 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
                    @click.stop.prevent="state.showDeleteAccount = false"
                  >
                    Cancel
                  </edge-shad-button>
                  <edge-shad-button
                    type="submit"
                    :disabled="state.loading"
                    variant="destructive"
                    class="mt-3 text-lg uppercase text-white"
                  >
                    <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                    Delete Account
                  </edge-shad-button>
                </div>
              </edge-v-alert>
            </edge-shad-form>
          </div>
        </CardContent>
      </Card>
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
