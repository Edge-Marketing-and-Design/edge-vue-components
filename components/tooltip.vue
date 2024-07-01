<script setup>

</script>

<template>
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger as-child>
        <slot />
      </TooltipTrigger>
      <TooltipContent>
        <p><slot name="content" /></p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
</template>
