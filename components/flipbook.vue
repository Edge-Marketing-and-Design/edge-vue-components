<script setup>
import Flipbook from 'flipbook-vue'
import { ChevronRightCircle } from 'lucide-vue-next'
const props = defineProps({
  magazine: {
    type: Object,
    default: () => ({}),
  },
  effect: {
    type: String,
    default: 'flip',
  },
})

const pages = computed(() => {
  const images = props.magazine?.ccState?.cfImages || {}

  return Object.keys(images)
    .sort() // Ensures order by "page-001", "page-002", etc.
    .map((key) => {
      const image = images[key]
      return image.variants.find(url => url.includes('/thumbnail'))
    })
    .filter(Boolean) // Removes undefined values in case no thumbnail is found
})

const pagesHighRes = computed(() => {
  const images = props.magazine?.ccState?.cfImages || {}

  return Object.keys(images)
    .sort() // Ensures order by "page-001", "page-002", etc.
    .map((key) => {
      const image = images[key]
      return image.variants.find(url => url.includes('/public'))
    })
    .filter(Boolean) // Removes undefined values in case no thumbnail is found
})
</script>

<template>
  <Flipbook v-if="props.effect === 'flip'" v-slot="flipbookSlot" class="h-full w-full" :gloss="1" :pages-hi-res="pagesHighRes" :flip-duration="500" :pages="pages">
    <edge-shad-button variant="icon" @click.prevent.stop="flipbookSlot.flipLeft">
      <ChevronLeftCircle />
    </edge-shad-button>
    <edge-shad-button variant="icon" @click.prevent.stop="flipbookSlot.flipRight">
      <ChevronRightCircle />
    </edge-shad-button>
  </Flipbook>

  <Carousel
    v-else-if="props.effect === 'slide'"
    class="ml-10 w-[90%]"
    :opts="{
      align: 'start',
      loop: true,
      containScroll: false,
      slidesToScroll: 1,
    }"
  >
    <CarouselContent>
      <CarouselItem v-for="page in pagesHighRes" :key="page" class="basis-1/2">
        <div class="p-1">
          <Card>
            <CardContent class="flex aspect-square items-center justify-center p-6">
              <img :src="page" class="object-cover w-full h-full">
            </CardContent>
          </Card>
        </div>
      </CarouselItem>
    </CarouselContent>
    <CarouselPrevious />
    <CarouselNext />
  </Carousel>
</template>

<style>
.flipbook {
  width: 90vw;
  height: 90vh;
}
</style>
