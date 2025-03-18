<script setup>
const props = defineProps({
  magazine: {
    type: Object,
    default: () => ({}),
  },
  effect: {
    type: String,
    default: 'flip',
  },
  teleportFlipbookControls: {
    type: String,
    default: '',
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
onMounted(() => {

})
</script>

<template>
  <edge-slider-flipbook
    v-if="props.effect === 'flip'"
    ref="flipbookRef" v-slot="flipbook" class="w-full bg-[#F7F9F8] h-full px-4 pt-8 pb-14"
    :magazine="props.magazine"
    :flip-duration="1000" :centering="false" :n-polygons="2"
    :click-to-zoom="true" :zoom-levels="[1, 2, 4]"
    :teleport="props.teleportFlipbookControls"
  >
    <slot v-bind="flipbook" name="controls" />
  </edge-slider-flipbook>
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
</style>
