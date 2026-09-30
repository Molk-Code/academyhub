import { Package } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; canEdit: boolean }

export function PropsTab({ productionId, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      canEdit={canEdit}
      collectionName="props"
      sceneField="propsIds"
      icon={Package}
      nameLabel="Item"
      namePlaceholder="Prop name"
      addLabel="Add Prop"
      emptyTitle="No props yet"
      useCharacterDatalist={false}
    />
  )
}
