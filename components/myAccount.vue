<script setup>
import { computed, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'
import { toTypedSchema } from '@vee-validate/zod'
import * as z from 'zod'
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')

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

const route = useRoute()
</script>

<template>
  <Card class="w-full flex-1 bg-muted/50 mx-auto w-full border-none shadow-none pt-2">
    <slot name="header">
      <edge-menu class="bg-secondary text-foreground rounded-none sticky top-0 py-6">
        <template #start>
          <slot name="header-start">
            <component :is="edgeGlobal.iconFromMenu(route)" class="mr-2" />
            <span class="capitalize">My Account</span>
          </slot>
        </template>
        <template #center>
          <slot name="header-center">
            <div class="w-full px-6" />
          </slot>
        </template>
        <template #end>
          <slot name="header-end">
            <div />
          </slot>
        </template>
      </edge-menu>
    </slot>
    <CardContent v-if="state.loaded" class="p-3 w-full overflow-y-auto scroll-area">
      <Card v-if="state.loaded" class="bg-transparent border-0">
        <CardContent>
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
            <div class="mb-2 font-bold">
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
                class="text-white bg-slate-800 hover:bg-slate-400"
              >
                <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                Update Email
              </edge-shad-button>
            </edge-shad-form>
            <Separator class="my-4 dark:bg-slate-600" />
            <edge-shad-form
              v-model="state.passwordForm"
              :schema="passwordSchema"
              @submit="updatePassword"
            >
              <div class="mb-2 font-bold">
                Change Password
              </div>
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
                class="text-white bg-slate-800 hover:bg-slate-400"
              >
                <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                Update Password
              </edge-shad-button>
            </edge-shad-form>
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
          <van-divider class="my-2">
            <h4 class="font-bold">
              Delete Account
            </h4>
          </van-divider>
          <Separator class="my-4 dark:bg-slate-600" />
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
                  variant="destructive"
                  class="text-white bg-slate-800 hover:bg-slate-400 mt-3"
                  @click.stop.prevent="state.showDeleteAccount = false"
                >
                  Cancel
                </edge-shad-button>
                <edge-shad-button
                  type="submit"
                  :disabled="state.loading"
                  variant="destructive"
                  class="text-white  mt-3 uppercase text-lg"
                >
                  <Loader2 v-if="state.loading" class="w-4 h-4 mr-2 animate-spin" />
                  Delete Account
                </edge-shad-button>
              </div>
            </edge-v-alert>
          </edge-shad-form>
        </CardContent>
      </Card>
    </CardContent>
  </Card>
</template>

<style lang="scss" scoped>

</style>
