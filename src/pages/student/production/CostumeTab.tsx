import { Shirt } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; canEdit: boolean }

export function CostumeTab({ productionId, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      canEdit={canEdit}
      collectionName="costumes"
      sceneField="costumeIds"
      icon={Shirt}
      nameLabel="Character"
      namePlaceholder="Character"
      addLabel="Add Costume"
      emptyTitle="No costumes yet"
      useCharacterDatalist
    />
  )
}
