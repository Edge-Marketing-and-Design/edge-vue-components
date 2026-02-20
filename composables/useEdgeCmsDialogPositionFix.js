import { useHead } from '#imports'

export const useEdgeCmsDialogPositionFix = () => {
  useHead({
    style: [
      {
        key: 'edge-cms-dialog-position-fix',
        id: 'edge-cms-dialog-position-fix',
        children: `
.fixed.left-1\\/2.top-1\\/2.-translate-x-1\\/2.-translate-y-1\\/2 {
  translate: initial !important;
  --un-translate-x: initial !important;
  --un-translate-y: initial !important;
}
        `,
      },
    ],
  })
}
