<script setup>
import { useVModel } from '@vueuse/core'
const props = defineProps({
  modelValue: {
    type: [String, Boolean, Number],
    required: false,
  },
  option: {
    type: Object,
    required: true,
  },
  label: {
    type: String,
    required: false,
  },
})
const emits = defineEmits(['update:modelValue'])
const edgeFirebase = inject('edgeFirebase')
const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  emits,
  prop: 'modelValue',
})

let staticOption = null

const state = reactive({
  loading: true,
})

onBeforeMount(async () => {
  staticOption = JSON.parse(JSON.stringify(props.option))
  // Helper: safely resolve nested keys like "meta.user"
  const getByPath = (obj, path) => {
    return path.split('.').reduce((acc, key) => {
      return (acc && acc[key] !== undefined) ? acc[key] : undefined
    }, obj)
  }

  if (!Array.isArray(props.option?.options)) {
    const collection = props.option?.options
    const staticSearch = new edgeFirebase.SearchStaticData()
    await staticSearch.getData(`${edgeGlobal.edgeState.organizationDocPath}/${collection}`)
    const options = Object.values(staticSearch.results.data) || []

    if (props.option.optionsKey && props.option.optionsValue) {
      const seen = new Set()

      staticOption.options = options
        .map((item) => {
          const title = getByPath(item, props.option.optionsKey)
          const name = getByPath(item, props.option.optionsValue)
          return (title != null && name != null && name !== '')
            ? { title, name }
            : null
        })
        .filter(Boolean) // remove nulls
        .filter((item) => {
          if (seen.has(item.name))
            return false
          seen.add(item.name)
          return true
        })
    }
    else {
      staticOption.options = options
    }
  }
  else {
    staticOption.options = props.option.options
      .map((item) => {
        const title = getByPath(item, props.option.optionsKey)
        const name = getByPath(item, props.option.optionsValue)
        return (title != null && name != null)
          ? { title, name }
          : null
      })
      .filter(Boolean) // remove nulls
  }
  staticOption.options.unshift({ title: '(none)', name: null })
  state.loading = false
})
</script>

<template>
  <edge-shad-select
    v-if="!state.loading && staticOption.options.length > 0"
    v-model="modelValue"
    :label="props.label"
    :name="props.option.field"
    :items="staticOption.options"
  />
</template>
