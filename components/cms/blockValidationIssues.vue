<script setup>
const props = defineProps({
  issues: {
    type: Array,
    default: () => [],
  },
})

const severityClass = severity => (severity === 'error'
  ? 'bg-destructive/10 text-destructive'
  : 'bg-muted text-muted-foreground')
</script>

<template>
  <ul class="space-y-1.5">
    <li v-for="(issue, index) in props.issues" :key="`${issue.code}-${issue.path}-${index}`" class="flex gap-2 text-sm">
      <span class="shrink-0 rounded px-1.5 py-0.5 text-xs font-medium uppercase" :class="severityClass(issue.severity)">
        {{ issue.severity }}
      </span>
      <span class="min-w-0">
        {{ issue.message }}
        <code class="ml-1 text-xs text-muted-foreground">{{ issue.code }}<template v-if="issue.path"> · {{ issue.path }}</template></code>
      </span>
    </li>
  </ul>
</template>
