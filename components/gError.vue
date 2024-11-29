<script setup>
import { defineProps } from 'vue'
const props = defineProps({
  error: {
    type: String,
    default: '',
  },
})

const firebaseErrorMap = {
  'auth/invalid-email': 'Oops! That doesn\'t look like a valid email address.',
  'auth/user-disabled': 'Oh no! This user account is currently disabled.',
  'auth/user-not-found': 'Hmm, we couldn\'t find a user with that email.',
  'auth/wrong-password': 'Whoops! That password doesn\'t seem to be correct.',
  'auth/email-already-in-use': 'It looks like someone else is already using that email address!',
  'auth/weak-password': 'Your password should be stronger! Try adding more characters or symbols.',
  'auth/operation-not-allowed': 'Sorry, this operation is not allowed.',
  'auth/account-exists-with-different-credential': 'This account already exists, but with different credentials.',
  'auth/credential-already-in-use': 'These credentials are already being used by someone else.',
  'auth/user-token-expired': 'Your session has expired. Please log in again.',
  'auth/network-request-failed': 'Oops, we couldn\'t connect to the server. Check your internet connection.',
  'storage/object-not-found': 'Oh dear, we couldn\'t find the file you\'re looking for.',
  'storage/bucket-not-found': 'We couldn\'t find the storage bucket you\'re looking for.',
  'storage/project-not-found': 'Hmm, we couldn\'t find the project you\'re looking for.',
  'storage/quota-exceeded': 'You\'ve reached your storage limit! Please try again later.',
  'storage/unauthorized': 'Hold on! You don\'t have permission to access this resource.',
  'storage/canceled': 'The upload was canceled.',
  'storage/invalid-checksum': 'The file seems to be corrupted. Please try again.',
  'firestore/permission-denied': 'You don\'t have permission to access this data.',
  'firestore/unavailable': 'Our Firestore service is taking a break. Please try again later.',
  'firestore/internal': 'Something went wrong on our end. We\'ll look into it!',
  'firestore/invalid-argument': 'You provided an invalid argument. Please double-check!',
  'firestore/cancelled': 'Operation cancelled. No worries!',
  'auth/popup-closed-by-user': 'Oops! The authentication popup was closed before the process could complete. Please try again.',
  'auth/invalid-verification-code': 'Uh oh! That verification code doesn\'t seem to be correct. Please try again.',
  'auth/too-many-requests': 'Whoa! You\'ve made too many attempts in a short period of time. Please wait a bit before trying again.',
  'auth/invalid-login-credentials': 'The provided login credentials are invalid. Please try again.',
  'auth/admin-restricted-operation': 'This operation is restricted to administrators only.',
  'auth/argument-error': 'There seems to be an error with the provided argument. Please check and try again.',
  'auth/app-not-authorized': 'This app is not authorized. Please contact the administrator.',
  'auth/app-not-installed': 'The app is not installed. Please install the app and try again.',
  'auth/captcha-check-failed': 'The captcha check failed. Please try again.',
  'auth/code-expired': 'The code has expired. Please request a new one.',
  'auth/cordova-not-ready': 'The system is not ready yet. Please wait a moment and try again.',
  'auth/cors-unsupported': 'Your browser does not support CORS. Please update your browser or try a different one.',
  'auth/custom-token-mismatch': 'The provided custom token does not match. Please check and try again.',
  'auth/requires-recent-login': 'For security reasons, this operation requires recent authentication. Log in again before retrying this request.',
  'auth/dependent-sdk-initialized-before-auth': 'An internal error occurred: a dependent SDK was initialized before the auth module.',
  'auth/dynamic-link-not-activated': 'The dynamic link is not activated. Please contact support.',
  'auth/email-change-needs-verification': 'Your email change needs verification. Please check your email for a verification link.',
  'auth/emulator-config-failed': 'The emulator configuration failed. Please check your setup.',
  'auth/expired-action-code': 'The action code has expired. Please request a new one.',
  'auth/cancelled-popup-request': 'The popup request was cancelled. Please try again.',
  'auth/internal-error': 'An internal error occurred. Please try again later.',
  // ... Add more error codes as needed
}

const getReadableFirebaseError = (errorCode) => {
  let code = ''

  if (typeof errorCode === 'string') {
    const match = errorCode.match(/(?:Firebase: Error \()?([a-z/,-]+)\)?/)
    code = match ? match[1] : ''
  }
  else if (errorCode instanceof Error) {
    const match = errorCode.message.match(/(?:Firebase: Error \()?([a-z/,-]+)\)?/)
    code = match ? match[1] : ''
  }

  if (!code) {
    console.log('Invalid error code:', errorCode)
    return 'An invalid error code was received. Please try again later.'
  }

  const readableError = firebaseErrorMap[code]

  if (readableError) {
    return readableError
  }
  else {
    console.log('Unknown Firebase error:', errorCode)
    return errorCode instanceof Error ? errorCode.message : errorCode
  }
}
</script>

<template>
  <Alert class="mt-2 bg-red-800">
    <AlertTitle>Error</AlertTitle>
    <AlertDescription>
      {{ getReadableFirebaseError(props.error) }}
    </AlertDescription>
  </Alert>
</template>

<style scoped>

</style>
