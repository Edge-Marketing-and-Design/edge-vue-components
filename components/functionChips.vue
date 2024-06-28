<script setup>
const props = defineProps({
  field: {
    type: Object,
    required: true,
  },
})
// Your JavaScript code goes here
</script>

<template>
  <div>
    <edge-chip>
      Type: {{ field.type }}
    </edge-chip>
    <edge-chip>
      Required
    </edge-chip>
    <DropdownMenu
      v-if="field?.enum?.length"
    >
      <DropdownMenuTrigger as-child>
        <edge-chip class="ml-1 cursor-pointer">
          Enum
        </edge-chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <edge-v-alert class="w-[300px]">
          <div class="text-lg">
            Enum
          </div>
          {{ field.enum.join(', ') }}
        </edge-v-alert>
      </DropdownMenuContent>
    </DropdownMenu>
    <DropdownMenu
      v-if="field.description"
    >
      <DropdownMenuTrigger as-child>
        <edge-chip class="ml-1 cursor-pointer">
          Description
        </edge-chip>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <edge-v-alert class="w-[300px]">
          <div class="text-lg">
            Description
          </div>
          {{ field.description }}
        </edge-v-alert>
      </DropdownMenuContent>
    </DropdownMenu>
  </div>
</template>

<style scoped>
</style>
