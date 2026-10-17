'use client'

/**
 * Task 81: SEARCHABLE product picker — bill banate waqt product ko naam/SKU likh kar
 * dhoond ke select karne ka option (plain dropdown mein sainkdon products scroll karna
 * mushkil tha). Shop picker (Task 67) ka wahi Popover + Command pattern — dono bill
 * forms (New Order + Purchase Entry) isi ek component se consistent search dete hain.
 */

import { useState } from 'react'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { Command, CommandInput, CommandList, CommandEmpty, CommandItem } from '@/components/ui/command'
import { Button } from '@/components/ui/button'
import { ChevronsUpDown, Check, Package } from 'lucide-react'

export interface ProductComboboxOption {
  id: string
  name: string
  sku?: string
  brand?: string
  /** sub-line info — rate/stock waghera (name ke neeche chhota text) */
  meta?: string
  /** pehle se add / out of stock — select nahi ho sakta, list mein reason ke sath dikhta hai */
  disabled?: boolean
  disabledReason?: string
}

export function ProductCombobox({ products, value, onSelect, placeholder = 'Product chunein...', searchPlaceholder = 'Product ka naam ya SKU likhein...', emptyMessage = 'Koi product nahi mila', triggerClassName = '' }: {
  products: ProductComboboxOption[]
  value: string
  onSelect: (id: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = products.find((p) => p.id === value)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className={`justify-between font-normal ${triggerClassName}`}>
          <span className={`truncate text-sm ${selected ? 'text-slate-800 font-medium' : 'text-slate-400'}`}>
            {selected ? selected.name : placeholder}
          </span>
          <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[min(24rem,calc(100vw-3rem))] p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList className="max-h-72">
            <CommandEmpty>{emptyMessage}</CommandEmpty>
            {products.map((p) => (
              <CommandItem key={p.id}
                value={`${p.name} ${p.sku ?? ''} ${p.brand ?? ''}`}
                disabled={p.disabled}
                onSelect={() => { onSelect(p.id); setOpen(false) }}>
                <Package className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-800 truncate">
                    {p.name}
                    {p.disabled && p.disabledReason
                      ? <span className="ml-1 text-[10px] font-normal text-slate-400">({p.disabledReason})</span>
                      : null}
                  </p>
                  <p className="text-[10px] text-slate-400 truncate">{[p.sku, p.brand, p.meta].filter(Boolean).join(' • ')}</p>
                </div>
                <Check className={`h-3.5 w-3.5 shrink-0 ${value === p.id ? 'opacity-100 text-emerald-600' : 'opacity-0'}`} />
              </CommandItem>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
