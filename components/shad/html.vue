<script setup>
// import { Extension } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import ImageExt from '@tiptap/extension-image'
import { Editor, EditorContent } from '@tiptap/vue-3'
import { useVModel } from '@vueuse/core'
import { onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Image,
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
  Trash2,
  Underline as UnderlineIcon,
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
  enabledToggles: {
    type: Array,
    required: false,
    default: () => ['bold', 'italic', 'strike', 'underline', 'code', 'codeBlock', 'heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'bulletlist', 'orderedlist', 'blockquote', 'horizontalrule', 'hardbreak', 'image'],
  },
})
const emits = defineEmits(['update:modelValue', 'request-image'])
const DEFAULT_IMAGE_WIDTH = 33
const sizeWidths = {
  small: 20,
  medium: DEFAULT_IMAGE_WIDTH,
  large: 50,
  full: 100,
}

const EdgeImage = ImageExt.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      size: {
        default: 'medium',
        parseHTML: element => element.getAttribute('data-size') || 'medium',
        renderHTML: attributes => ({
          'data-size': attributes.size || 'medium',
        }),
      },
      float: {
        default: 'left',
        parseHTML: (element) => {
          const styleFloat = element.style?.float || element.style?.cssFloat
          return styleFloat || element.getAttribute('data-float') || 'left'
        },
        renderHTML: attributes => ({
          'data-float': attributes.float || 'left',
        }),
      },
      width: {
        default: DEFAULT_IMAGE_WIDTH,
        parseHTML: (element) => {
          const attr = element.getAttribute('data-width')
          if (attr)
            return Number.parseFloat(attr)
          const styleWidth = element.style?.width
          if (styleWidth && styleWidth.endsWith('%'))
            return Number.parseFloat(styleWidth.replace('%', ''))
          const sizeAttr = element.getAttribute('data-size')
          if (sizeAttr && sizeWidths[sizeAttr])
            return sizeWidths[sizeAttr]
          return DEFAULT_IMAGE_WIDTH
        },
        renderHTML: (attributes) => {
          const widthValue = Number.parseFloat(attributes.width)
          const width = Number.isFinite(widthValue) ? widthValue : DEFAULT_IMAGE_WIDTH
          const floatValue = attributes.float || 'left'
          let marginValue = '0.75rem 1.5rem 1rem 0'
          if (floatValue === 'right')
            marginValue = '0.75rem 0 1rem 1.5rem'
          else if (floatValue === 'none')
            marginValue = '1.25rem auto'
          const styleSegments = [`width: ${width}%;`, `float: ${floatValue};`, `margin: ${marginValue};`]
          return {
            'data-width': width,
            'style': styleSegments.join(' '),
          }
        },
      },
    }
  },
}).configure({
  HTMLAttributes: {
    class: 'edge-editor-image',
  },
})

const modelValue = useVModel(props, 'modelValue', emits, {
  passive: false,
  prop: 'modelValue',
})

const editor = ref(null)
const imageState = reactive({
  active: false,
  size: 'medium',
  float: 'left',
  width: DEFAULT_IMAGE_WIDTH,
})

const updateImageState = () => {
  if (!editor.value) {
    imageState.active = false
    imageState.size = 'medium'
    imageState.float = 'left'
    imageState.width = DEFAULT_IMAGE_WIDTH
    return
  }
  const isActive = editor.value.isActive('image')
  imageState.active = isActive
  if (isActive) {
    const attrs = editor.value.getAttributes('image') || {}
    imageState.size = attrs.size || 'medium'
    imageState.float = attrs.float || 'left'
    let widthVal = Number.parseFloat(attrs.width)
    if (!Number.isFinite(widthVal) && sizeWidths[imageState.size])
      widthVal = sizeWidths[imageState.size]
    if (Number.isFinite(widthVal))
      imageState.width = Math.min(100, Math.max(10, Math.round(widthVal)))
  }
  else {
    imageState.size = 'medium'
    imageState.float = 'left'
    imageState.width = DEFAULT_IMAGE_WIDTH
  }
}

watch(modelValue, () => {
  if (!editor.value)
    return
  const isSame = editor.value.getHTML() === modelValue.value

  // JSON
  // const isSame = JSON.stringify(this.editor.getJSON()) === JSON.stringify(value)

  if (isSame) {
    return
  }

  editor.value.commands.setContent(modelValue.value, false)
  updateImageState()
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
      EdgeImage,
      Underline,
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
      updateImageState()
    },
  })
  editor.value.on('selectionUpdate', updateImageState)
  editor.value.on('transaction', updateImageState)
  updateImageState()
})

onBeforeUnmount(() => {
  if (editor.value) {
    editor.value.off('selectionUpdate', updateImageState)
    editor.value.off('transaction', updateImageState)
    editor.value.destroy()
  }
})

const addImage = () => {
  emits('request-image')
}

const insertImage = (url) => {
  if (!url || !editor.value) {
    return
  }
  editor.value.chain().focus().setImage({
    src: url,
    size: 'medium',
    float: 'left',
    width: DEFAULT_IMAGE_WIDTH,
  }).run()
  updateImageState()
}

const setImageSize = (size) => {
  if (!editor.value || !imageState.active)
    return
  const width = sizeWidths[size] ?? 33
  const attrs = { size, width }
  if (size === 'full')
    attrs.float = 'none'
  editor.value.chain().focus().updateAttributes('image', attrs).run()
  updateImageState()
}

const setImageFloat = (float) => {
  if (!editor.value || !imageState.active)
    return
  const attrs = { float }
  if (float !== 'none' && (imageState.size === 'full' || imageState.width >= 90)) {
    attrs.size = 'large'
    attrs.width = 50
  }
  if (float === 'none' && (imageState.size !== 'full' && imageState.width >= 90)) {
    attrs.size = 'full'
    attrs.width = 100
  }
  editor.value.chain().focus().updateAttributes('image', attrs).run()
  updateImageState()
}

const setImageWidth = (width) => {
  if (!editor.value || !imageState.active)
    return
  const normalized = Math.min(100, Math.max(10, Math.round(width)))
  let size = 'custom'
  if (normalized <= 22)
    size = 'small'
  else if (normalized < 41)
    size = 'medium'
  else if (normalized < 75)
    size = 'large'
  else if (normalized >= 95)
    size = 'full'
  const attrs = { width: normalized, size }
  if (size === 'full')
    attrs.float = 'none'
  editor.value.chain().focus().updateAttributes('image', attrs).run()
  updateImageState()
}

const removeImage = () => {
  if (!editor.value || !imageState.active)
    return
  editor.value.chain().focus().deleteSelection().run()
  updateImageState()
}

defineExpose({
  insertImage,
})
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
                    v-if="enabledToggles.includes('bold')"
                    value="bold"
                    :disabled="!editor.can().chain().focus().toggleBold().run()"
                    :data-state="editor.isActive('bold') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleBold().run()"
                  >
                    <Bold :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('italic')"
                    value="italic"
                    :disabled="!editor.can().chain().focus().toggleItalic().run()"
                    :data-state="editor.isActive('italic') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleItalic().run()"
                  >
                    <Italic :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('underline')"
                    value="underline"
                    :disabled="!editor.can().chain().focus().toggleUnderline().run()"
                    :data-state="editor.isActive('underline') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleUnderline().run()"
                  >
                    <UnderlineIcon :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('strike')"
                    value="strike"
                    :disabled="!editor.can().chain().focus().toggleStrike().run()"
                    :data-state="editor.isActive('strike') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleStrike().run()"
                  >
                    <Strikethrough :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup v-if="enabledToggles.includes('code') || enabledToggles.includes('codeBlock')" type="single">
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('code')"
                    value="code"
                    :disabled="!editor.can().chain().focus().toggleCode().run()"
                    :data-state="editor.isActive('code') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleCode().run()"
                  >
                    <Code :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('codeBlock')"
                    value="codeBlock"
                    :disabled="!editor.can().chain().focus().toggleCodeBlock().run()"
                    :data-state="editor.isActive('codeBlock') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleCodeBlock().run()"
                  >
                    <SquareCode :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <ToggleGroup
                  v-if="enabledToggles.includes('heading1') || enabledToggles.includes('heading2') || enabledToggles.includes('heading3') || enabledToggles.includes('heading4') || enabledToggles.includes('heading5') || enabledToggles.includes('heading6')"
                  type="single"
                >
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading1')"
                    value="heading1"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 1 }).run()"
                    :data-state="editor.isActive('heading', { level: 1 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 1 }).run()"
                  >
                    <Heading1 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading2')"
                    value="heading2"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 2 }).run()"
                    :data-state="editor.isActive('heading', { level: 2 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 2 }).run()"
                  >
                    <Heading2 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading3')"
                    value="heading3"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 3 }).run()"
                    :data-state="editor.isActive('heading', { level: 3 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 3 }).run()"
                  >
                    <Heading3 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading4')"
                    value="heading4"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 4 }).run()"
                    :data-state="editor.isActive('heading', { level: 4 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 4 }).run()"
                  >
                    <Heading4 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading5')"
                    value="heading5"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 5 }).run()"
                    :data-state="editor.isActive('heading', { level: 5 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 5 }).run()"
                  >
                    <Heading5 :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('heading6')"
                    value="heading6"
                    :disabled="!editor.can().chain().focus().toggleHeading({ level: 6 }).run()"
                    :data-state="editor.isActive('heading', { level: 6 }) ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleHeading({ level: 6 }).run()"
                  >
                    <Heading6 :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>

                <Button
                  v-if="enabledToggles.includes('paragraph')"
                  variant="outline"
                  :data-state="editor.isActive('paragraph') ? 'on' : 'off'"
                  @click.prevent="editor.chain().focus().setParagraph().run()"
                >
                  <Pilcrow :size="16" />
                </Button>

                <Button
                  v-if="enabledToggles.includes('image')"
                  variant="outline"
                  @click.prevent="addImage"
                >
                  <Image :size="16" />
                </Button>

                <ToggleGroup type="single">
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('bulletlist')"
                    value="bulletList"
                    :disabled="!editor.can().chain().focus().toggleBulletList().run()"
                    :data-state="editor.isActive('bulletList') ? 'on' : 'off'"
                    @click.prevent="editor.chain().focus().toggleBulletList().run()"
                  >
                    <List :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    v-if="enabledToggles.includes('orderedlist')"
                    value="orderedList"
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
                  v-if="enabledToggles.includes('blockquote')"
                  :disabled="!editor.can().chain().focus().toggleBlockquote().run()"
                  :data-state="editor.isActive('blockQuote') ? 'on' : 'off'"
                  @click.prevent="editor.chain().focus().toggleBlockquote().run()"
                >
                  <TextQuote :size="16" />
                </Toggle>

                <Button
                  v-if="enabledToggles.includes('horizontalrule')"
                  variant="outline"
                  title="Horizontal Rule"
                  @click.prevent="editor.chain().focus().setHorizontalRule().run()"
                >
                  <Minus :size="16" />
                </Button>

                <Button
                  v-if="enabledToggles.includes('hardbreak')"
                  variant="outline"
                  title="Hard Break"
                  @click.prevent="editor.chain().focus().setHardBreak().run()"
                >
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
              <div
                v-if="enabledToggles.includes('image') && imageState.active"
                class="flex flex-wrap items-center gap-2 border-t border-secondary/60 px-2 pt-2 mt-2"
              >
                <ToggleGroup type="single">
                  <ToggleGroupItem
                    value="imageSizeSmall"
                    :data-state="imageState.size === 'small' ? 'on' : 'off'"
                    title="Small image"
                    @click.prevent="setImageSize('small')"
                  >
                    S
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="imageSizeMedium"
                    :data-state="imageState.size === 'medium' ? 'on' : 'off'"
                    title="Medium image"
                    @click.prevent="setImageSize('medium')"
                  >
                    M
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="imageSizeLarge"
                    :data-state="imageState.size === 'large' ? 'on' : 'off'"
                    title="Large image"
                    @click.prevent="setImageSize('large')"
                  >
                    L
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="imageSizeFull"
                    :data-state="imageState.size === 'full' ? 'on' : 'off'"
                    title="Full width image"
                    @click.prevent="setImageSize('full')"
                  >
                    F
                  </ToggleGroupItem>
                </ToggleGroup>
                <ToggleGroup type="single">
                  <ToggleGroupItem
                    value="imageFloatLeft"
                    :data-state="imageState.float === 'left' ? 'on' : 'off'"
                    title="Float left"
                    @click.prevent="setImageFloat('left')"
                  >
                    <AlignLeft :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="imageFloatNone"
                    :data-state="imageState.float === 'none' ? 'on' : 'off'"
                    title="No float"
                    @click.prevent="setImageFloat('none')"
                  >
                    <AlignCenter :size="16" />
                  </ToggleGroupItem>
                  <ToggleGroupItem
                    value="imageFloatRight"
                    :data-state="imageState.float === 'right' ? 'on' : 'off'"
                    title="Float right"
                    @click.prevent="setImageFloat('right')"
                  >
                    <AlignRight :size="16" />
                  </ToggleGroupItem>
                </ToggleGroup>
                <div class="flex items-center gap-2 px-2">
                  <span class="text-xs text-muted-foreground">
                    Width
                  </span>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    step="1"
                    class="h-2 w-32 cursor-pointer"
                    :value="imageState.width"
                    @input="setImageWidth(Number(($event.target).value))"
                  >
                  <span class="text-xs w-12 text-right text-muted-foreground">
                    {{ `${imageState.width}%` }}
                  </span>
                </div>
                <Button
                  variant="outline"
                  title="Remove image"
                  @click.prevent="removeImage"
                >
                  <Trash2 :size="16" />
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
  min-height: 300px;
  max-height: 300px;
  overflow-y: auto;

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
  ol {
    list-style-type: decimal;
    list-style-position: outside;
  }
  ul {
    li {
      list-style-type: disc;
      list-style-position: outside;
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

  &::after {
    content: '';
    display: block;
    clear: both;
  }

  img.edge-editor-image {
    border-radius: 0.375rem;
    display: inline-block;
    height: auto;
    max-width: 100%;
  }

  img.edge-editor-image[data-size='small'] {
    width: 20%;
    min-width: 120px;
    max-width: 160px;
  }

  img.edge-editor-image[data-size='medium'] {
    width: 33%;
    min-width: 160px;
    max-width: 320px;
  }

  img.edge-editor-image[data-size='large'] {
    width: 50%;
    min-width: 200px;
    max-width: 480px;
  }

  img.edge-editor-image[data-size='full'] {
    width: 100%;
    max-width: 100%;
  }

  img.edge-editor-image[data-float='left'] {
    float: left;
    margin: 0.75rem 1.5rem 1rem 0;
  }

  img.edge-editor-image[data-float='right'] {
    float: right;
    margin: 0.75rem 0 1rem 1.5rem;
  }

  img.edge-editor-image[data-float='none'] {
    float: none;
    display: block;
    margin: 1.25rem auto;
  }

  img.edge-editor-image.ProseMirror-selectednode {
   border: 2px solid black;
  }

  img.edge-editor-image[data-size='full'][data-float='none'] {
    margin-left: 0;
    margin-right: 0;
  }
}
</style>
