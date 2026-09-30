import { Sparkles } from 'lucide-react'
import { ItemTab } from './ItemTab'

interface Props { productionId: string; productionTitle: string; canEdit: boolean }

export function MakeupTab({ productionId, productionTitle, canEdit }: Props) {
  return (
    <ItemTab
      productionId={productionId}
      productionTitle={productionTitle}
      canEdit={canEdit}
      collectionName="makeup"
      sceneField="makeupIds"
      icon={Sparkles}
      deptLabel="Make-up"
      nameLabel="Character"
      namePlaceholder="Character"
      addLabel="Add Make-up"
      emptyTitle="No make-up yet"
      useCharacterDatalist
    />
  )
}
