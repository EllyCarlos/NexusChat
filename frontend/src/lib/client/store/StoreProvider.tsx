'use client'
import { useState } from 'react'
import { Provider } from 'react-redux'
import { makeStore } from './store'

export default function StoreProvider({
  children,
}: {
  children: React.ReactNode
}) {
  const [store] = useState(makeStore)

  return <Provider store={store}>{children}</Provider>
}
