<script setup>
// import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import ImageExt from '@tiptap/extension-image'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { useVModel } from '@vueuse/core'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Italic,
  List,
  ListOrdered,
  ListTree,
  Minus,
  Pilcrow,
  Redo,
  RemoveFormatting,
  SquareCode,
  Strikethrough,
  TextQuote,
  Undo,
  WrapText,
} from 'lucide-vue-next'
import ToggleGroupItem from '~/components/ui/toggle-group/ToggleGroupItem.vue'

const props = defineProps({
  name: {
    type: String,
    required: true,
  },
  defaultValue: {
    type: [String, Number],
    required: false,
  },
  modelValue: {
    type: String,
    default: '',
  },
  class: {
    type: null,
    required: false,
  },
  placeholder: {
    type: String,
    required: false,
  },
  label: {
    type: String,
    required: false,
  },
  description: {
    type: String,
    required: false,
  },
  maskOptions: {
    type: [Object],
    required: false,
    default: null,
  },
  disabled: {
    type: Boolean,
    required: false,
    default: false,
  },
})

const emits = defineEmits(['update:modelValue'])

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const editor = ref(null)
watch(modelValue, () => {
  const isSame = editor.value.getHTML() === modelValue.value

  // JSON
  // const isSame = JSON.stringify(this.editor.getJSON()) === JSON.stringify(value)

  if (isSame) {
    return
  }

  editor.value.commands.setContent(modelValue.value, false)
})

/* const PreventEnterSubmit = Extension.create({
  name: 'preventEnterSubmit',

  addKeyboardShortcuts() {
    return {
      Enter: (editor, event) => {
        console.log('Enter pressed', event)
        editor.commands.enter()
        // event.stopPropagation() // Varsayılan davranışı engelle
        return true // Editör içinde Enter'ın çalışmasını sağla
      },
    }
  },
}) */

onMounted(() => {
  editor.value = new Editor({
    extensions: [
      StarterKit,
      TextStyle,
      ImageExt,
      // PreventEnterSubmit,
    ],
    /*     onCreate({ editor }) {
    // DOM olay dinleyicisi ekleme
      console.log(editor)
      editor.view.dom.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          console.log('stopping enter propagation')
          // Formun submit olmasını engeller
          event.stopPropagation()
        }
      })
    }, */
    content: modelValue.value,
    onUpdate: () => {
      // HTML
      emits('update:modelValue', editor.value.getHTML())

      // JSON
      // this.$emit('update:modelValue', this.editor.getJSON())
    },
  })
})

onBeforeUnmount(() => {
  editor.value.destroy()
})

const addImage = () => {
  const url = window.prompt('URL')

  if (url) {
    editor.value.chain().focus().setImage({ src: url }).run()
  }
}
</script>

<template>
  <div class="my-4">
    <FormField v-slot="{ componentField }" :name="props.name">
      <FormItem>
        <FormLabel>
          {{ props.label }}
          <div class="ml-auto inline-block">
            <slot />
          </div>
        </FormLabel>
        <FormControl>
          <div v-if="editor" class="relative w-full  items-center">
            <div class="flex flex-col w-full py-2 border border-secondary">
              <div class="button-group w-full flex flex-wrap gap-2">
                <ToggleGroup type="multiple">
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleBold().run()"
                    :data-state="editor.isActive('bold') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleBold().run()"
                  >
                    <Bold :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleItalic().run()"
                    :data-state="editor.isActive('italic') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleItalic().run()"
                  >
                    <Italic :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    :disabled="!editor.can().chain().focus().toggleStrike().run()"
                    :data-state="editor.isActive('strike') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleStrike().run()"
                  >
                    <Strikethrough :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single">
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleCode().run()"
                    :data-state="editor.isActive('code') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleCode().run()"
                  >
                    <Code :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleCodeBlock().run()"
                    :data-state="editor.isActive('codeBlock') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleCodeBlock().run()"
                  >
                    <SquareCode :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <ToggleGroup type="single">
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 1 }).run()"
                    :data-state="editor.isActive('heading', { level: 1 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 1 }).run()"
                  >
                    <Heading1 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 2 }).run()"
                    :data-state="editor.isActive('heading', { level: 2 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 2 }).run()"
                  >
                    <Heading2 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 3 }).run()"
                    :data-state="editor.isActive('heading', { level: 3 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 3 }).run()"
                  >
                    <Heading3 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 4 }).run()"
                    :data-state="editor.isActive('heading', { level: 4 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 4 }).run()"
                  >
                    <Heading4 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 5 }).run()"
                    :data-state="editor.isActive('heading', { level: 5 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 5 }).run()"
                  >
                    <Heading5 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem

                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 6 }).run()"
                    :data-state="editor.isActive('heading', { level: 6 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 6 }).run()"
                  >
                    <Heading6 :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button
                  variant="outline"
                  :data-state="editor.isActive('paragraph') ? 'on' : 'off'"
                  @click.prevent="editor.chain().focus().setParagraph().run()"
                >
                  <Pilcrow :size="16" />
                </Button>

                <Button
                  variant="outline"
                  @click.prevent="addImage"
                >
                  <Image :size="16" />
                </Button>

                <ToggleGroup type="single">
                  <ToggleGroupItem
                    :disabled="!editor.can().chain().focus().toggleBulletList().run()"
                    :data-state="editor.isActive('bulletList') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleBulletList().run()"
                  >
                    <List :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    :disabled="!editor.can().chain().focus().toggleOrderedList().run()"
                    :data-state="editor.isActive('orderedList') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleOrderedList().run()"
                  >
                    <ListOrdered :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button variant="outline" title="Clear formatting" @click.prevent="editor.chain().focus().unsetAllMarks().run()">
                  <RemoveFormatting :size="16" />
                </Button>

                <Button variant="outline" title="Clear / Flatten Structure" @click.prevent="editor.chain().focus().clearNodes().run()">
                  <ListTree :size="16" />
                </Button>

                <Toggle
                  :disabled="!editor.can().chain().focus().toggleBlockquote().run()"
                  :data-state="editor.isActive('blockQuote') ? 'on' : 'off'"
                  @click.prevent="editor.chain().focus().toggleBlockquote().run()"
                >
                  <TextQuote :size="16" />
                </Toggle>

                <Button variant="outline" title="Horizontal Rule" @click.prevent="editor.chain().focus().setHorizontalRule().run()">
                  <Minus :size="16" />
                </Button>

                <Button variant="outline" title="Hard Break" @click.prevent="editor.chain().focus().setHardBreak().run()">
                  <WrapText :size="16" />
                </Button>

                <Button
                  variant="outline"
                  title="Undo"
                  :disabled="!editor.can().chain().focus().undo().run()"
                  @click.prevent="editor.chain().focus().undo().run()"
                >
                  <Undo :size="16" />
                </Button>
                <Button
                  variant="outline"
                  title="Redo"
                  :disabled="!editor.can().chain().focus().redo().run()"
                  @click.prevent="editor.chain().focus().redo().run()"
                >
                  <Redo :size="16" />
                </Button>
              </div>
            </div>
            <EditorContent
              class="border border-secondary bg-background"
              :editor="editor"
              v-bind="componentField"
            />
            <span class="absolute end-0 inset-y-0 flex items-center justify-center px-2">
              <slot name="icon" />
            </span>
          </div>
        </FormControl>
        <FormDescription>
          {{ props.description }}
          <slot name="description" />
        </FormDescription>
        <FormMessage />
      </FormItem>
    </FormField>
  </div>
</template>

<style lang="scss">
/* Basic editor styles */
.tiptap {
  :first-child {
    margin-top: 0;
  }

  /* List styles */
  ul,
  ol {
    padding: 0 1rem;
    margin: 1.25rem 1rem 1.25rem 0.4rem;

    li p {
      margin-top: 0.25em;
      margin-bottom: 0.25em;
    }
  }

  /* Heading styles */
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    line-height: 1.1;
    margin-top: 2.5rem;
    text-wrap: pretty;
  }

  h1,
  h2 {
    margin-top: 3.5rem;
    margin-bottom: 1.5rem;
  }

  h1 {
    font-size: 1.4rem;
  }

  h2 {
    font-size: 1.2rem;
  }

  h3 {
    font-size: 1.1rem;
  }

  h4,
  h5,
  h6 {
    font-size: 1rem;
  }

  /* Code and preformatted text styles */
  code {
    background-color: var(--purple-light);
    border-radius: 0.4rem;
    color: var(--black);
    font-size: 0.85rem;
    padding: 0.25em 0.3em;
  }

  pre {
    background: var(--black);
    border-radius: 0.5rem;
    color: var(--white);
    font-family: 'JetBrainsMono', monospace;
    margin: 1.5rem 0;
    padding: 0.75rem 1rem;

    code {
      background: none;
      color: inherit;
      font-size: 0.8rem;
      padding: 0;
    }
  }

  blockquote {
    border-left: 3px solid var(--gray-3);
    margin: 1.5rem 0;
    padding-left: 1rem;
  }

  hr {
    border: none;
    border-top: 1px solid var(--gray-2);
    margin: 2rem 0;
  }
}
</style>
