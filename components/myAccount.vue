<script setup>
import { computed, inject, nextTick, onBeforeMount, reactive, watch } from 'vue'

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
const updateUser = async (event) => {
  const results = await event
  if (results.valid) {
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
    await nextTick()
    state.loaded = true
  }
}
const updatePassword = async (event) => {
  const results = await event
  if (results.valid) {
    state.passwordError = await edgeFirebase.setPassword(state.oldPassword, state.newPassword)
    // TODO - Use gError here
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
    state.loaded = false
    await nextTick()
    state.loaded = true
  }
}
const deleteAccount = async (event) => {
  const results = await event
  if (results.valid) {
    state.loading = true
    await edgeFirebase.runFunction('edgeFirebase-deleteSelf', { uid: edgeFirebase.user.uid })
    await edgeFirebase.logOut()
    router.push('/app/login')
  }
}
// const onSubmit = async (event) => {
//   const results = await event
//   if (results.valid) {
//     updatePassword()
//     edgeState.changeTracker = {}
//     state.loaded = false
//     await nextTick()
//     state.loaded = true
//   }
// }
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
</script>

<template>
  <v-card v-if="state.loaded" variant="flat">
    <v-card-text>
      <h3 class="mb-3">
        My Account
      </h3>
      <template v-if="edgeFirebase.user.firebaseUser.providerData.length === 0">
        <v-alert>
          Logged in as:
          <v-alert-title>{{ state.username }}</v-alert-title>
          <strong>Custom Provider</strong>
          <Separator class="my-4 dark:bg-slate-600" />
          Notice: You're signed in with a custom provider. Nothing to update here.
        </v-alert>
      </template>
      <template v-else-if="edgeFirebase.user.firebaseUser.providerData[0].providerId === 'password'">
        <span class="headline">Update Email</span>
        <v-form
          v-model="state.userForm"
          validate-on="submit"
          @submit.prevent="updateUser"
        >
          <edge-g-input
            v-model="state.username"
            name="username"
            field-type="text"
            :rules="[edgeGlobal.edgeRules.required, edgeGlobal.edgeRules.email]"
            label="Username"
            parent-tracker-id="my-account"
            hint="Update your email address, which also serves as your username."
            persistent-hint
          />
          <v-alert
            v-if="state.userError.message !== ''"
            :type="state.userError.success ? 'success' : 'error'"
            dismissible
            class="mt-0 mb-3 text-caption" density="compact" variant="tonal"
          >
            {{ state.userError.message }}
          </v-alert>

          <v-btn
            type="submit"
            color="secondary"
            variant="text"
          >
            Update Email
          </v-btn>
        </v-form>
        <Separator class="my-4 dark:bg-slate-600" />
        <v-form
          v-model="state.passwordForm"
          validate-on="submit"
          @submit.prevent="updatePassword"
        >
          <span class="headline">Change Password</span>

          <v-text-field
            v-model="state.oldPassword"
            :rules="[edgeGlobal.edgeRules.required]"
            :type="state.passwordShow ? 'text' : 'password'"
            label="Old Password"
            placeholder="Enter your old password"
            variant="underlined"
            :append-inner-icon="state.passwordShow ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append-inner="state.passwordShow = !state.passwordShow"
          />
          <v-text-field
            v-model="state.newPassword"
            :rules="[edgeGlobal.edgeRules.password]"
            :type="state.passwordShow ? 'text' : 'password'"
            label="New Password"
            placeholder="Enter your new password"
            variant="underlined"
            :append-inner-icon="state.passwordShow ? 'mdi-eye' : 'mdi-eye-off'"
            @click:append-inner="state.passwordShow = !state.passwordShow"
          />
          <v-alert
            v-if="state.passwordError.message !== ''"
            :type="state.passwordError.success ? 'success' : 'error'"
            dismissible
            class="mt-0 mb-3 text-caption" density="compact" variant="tonal"
          >
            {{ state.passwordError.message }}
          </v-alert>

          <v-btn
            type="submit"
            color="secondary"
            variant="text"
          >
            Update Password
          </v-btn>
        </v-form>
      </template>
      <template v-else>
        <v-alert>
          Logged in as:
          <v-alert-title>{{ edgeFirebase.user.firebaseUser.providerData[0].email }}</v-alert-title>
          <strong>Provider: {{ edgeFirebase.user.firebaseUser.providerData[0].providerId }}</strong>
          <Separator class="my-4 dark:bg-slate-600" />
          Notice: You're signed in with a third-party provider. To update your login information, please visit your provider's account settings. Changes cannot be made directly within this app.
        </v-alert>
      </template>
      <van-divider class="my-2">
        <h4>
          Delete Account
        </h4>
      </van-divider>
      <Separator class="my-4 dark:bg-slate-600" />
      <v-form
        v-model="state.deleteForm"
        validate-on="submit"
        @submit.prevent="deleteAccount"
      >
        <v-btn v-if="!state.showDeleteAccount" variant="outlined" block @click="state.showDeleteAccount = true">
          <v-icon class="mr-2">
            mdi-delete
          </v-icon>
          Delete Account
        </v-btn>
        <v-alert v-else closable variant="tonal" border="start" type="warning" prominent @click:close="state.showDeleteAccount = false">
          <template #title>
            Are you sure?
          </template>
          <template #text>
            <h3 class="mt-2">
              <strong>Warning:</strong> Deleting your account will permanently remove all of your data from this app. This action cannot be undone.
            </h3>
            <edge-g-input
              name="delete_account"
              field-type="boolean"
              label="I understand the consequences of deleting my account."
              :disable-tracking="true"
              :rules="[edgeGlobal.edgeRules.required]"
            />
          </template>
          <v-row class="mt-2" justify="end">
            <v-col cols="auto">
              <v-btn
                color="error"
                type="submit"
                :loading="state.loading"
              >
                Delete Account
              </v-btn>
            </v-col>
          </v-row>
        </v-alert>
      </v-form>
    </v-card-text>
  </v-card>
</template>

<style lang="scss" scoped>

</style>
