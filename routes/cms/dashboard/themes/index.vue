<script setup>
const state = reactive({
  filter: '',
})

definePageMeta({
  middleware: 'auth',
})
</script>

<template>
  <div
    v-if="edgeGlobal.edgeState.organizationDocPath"
  >
    <edge-dashboard :filter="state.filter" collection="themes" class="pt-0 flex-1">
      <template #list="slotProps">
        <template v-for="item in slotProps.filtered" :key="item.docId">
          <edge-shad-button variant="text" class="cursor-pointer w-full flex justify-between items-center py-2 gap-3" :to="`/app/dashboard/themes/${item.docId}`">
            <div>
              <Avatar class="cursor-pointer p-0 h-8 w-8 mr-2">
                <FilePenLine class="h-5 w-5" />
              </Avatar>
            </div>
            <div class="grow text-left">
              <div class="text-lg">
                {{ item.name }}
              </div>
            </div>
            <div>
              <edge-shad-button
                size="icon"
                class="bg-slate-600 h-7 w-7"
                @click.stop="slotProps.deleteItem(item.docId)"
              >
                <Trash class="h-5 w-5" />
              </edge-shad-button>
            </div>
          </edge-shad-button>
          <Separator class="dark:bg-slate-600" />
        </template>
      </template>
    </edge-dashboard>
  </div>
</template>
