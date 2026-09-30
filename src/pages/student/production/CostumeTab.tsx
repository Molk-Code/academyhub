import { Shirt } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; productionTitle: string; canEdit: boolean }

export function CostumeTab({ productionId, productionTitle, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      productionTitle={productionTitle}
      canEdit={canEdit}
      collectionName="costumes"
      sceneField="costumeIds"
      icon={Shirt}
      deptLabel="Costume"
      nameLabel="Character"
      namePlaceholder="Character"
      addLabel="Add Costume"
      emptyTitle="No costumes yet"
      useCharacterDatalist
    />
  )
}
