import { Sparkles } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; canEdit: boolean }

export function MakeupTab({ productionId, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      canEdit={canEdit}
      collectionName="makeup"
      sceneField="makeupIds"
      icon={Sparkles}
      nameLabel="Character"
      namePlaceholder="Character"
      addLabel="Add Make-up"
      emptyTitle="No make-up yet"
      useCharacterDatalist
    />
  )
}
