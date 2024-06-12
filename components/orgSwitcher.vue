<script setup>
import { inject } from 'vue'

const props = defineProps({
  title: {
    type: String,
    default: 'Organization(s)',
  },
})
const edgeFirebase = inject('edgeFirebase')
// const edgeGlobal = inject('edgeGlobal')
</script>

<template>
  <v-list :lines="false" density="compact" nav>
    <v-list-subheader>{{ props.title }}</v-list-subheader>
    <v-list-item v-for="org in edgeGlobal.edgeState.organizations" :key="org.docId" :value="org.docId" @click="edgeGlobal.setOrganization(org.docId, edgeFirebase)">
      <v-list-item-title>{{ edgeFirebase.data[`organizations/${org.docId}`].name }} <v-icon v-if="org.docId === edgeGlobal.edgeState.currentOrganization" class="ml-2" icon="mdi-check" /></v-list-item-title>
    </v-list-item>
  </v-list>
</template>

<style lang="scss" scoped>

</style>
