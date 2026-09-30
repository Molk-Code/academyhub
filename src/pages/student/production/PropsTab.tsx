import { Package } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; productionTitle: string; canEdit: boolean }

export function PropsTab({ productionId, productionTitle, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      productionTitle={productionTitle}
      canEdit={canEdit}
      collectionName="props"
      sceneField="propsIds"
      icon={Package}
      deptLabel="Props"
      nameLabel="Item"
      namePlaceholder="Prop name"
      addLabel="Add Prop"
      emptyTitle="No props yet"
      useCharacterDatalist={false}
    />
  )
}
