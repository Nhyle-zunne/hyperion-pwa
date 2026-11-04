import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import AccountScreen from '../../src/screens/AccountScreen'
import BasketScreen from '../../src/screens/BasketScreen'
import OrdersPaymentHistoryScreen from '../../src/screens/OrdersPaymentHistoryScreen'
import { fixtureCalls } from '../../src/lib/supabase'
import '../../src/index.css'

Object.assign(window, { accountFixtureCalls: fixtureCalls })
document.documentElement.dataset.theme = 'light'
const initialPath = new URLSearchParams(location.search).get('section') === 'orders' ? '/orders' : '/checkout?buy_product=gmdss&buy_term=month'
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initialPath]}>
  <Routes>
    <Route path="/account" element={<AccountScreen key="account" />} />
    <Route path="/checkout" element={<AccountScreen key="checkout"><BasketScreen /></AccountScreen>} />
    <Route path="/orders" element={<AccountScreen key="orders"><OrdersPaymentHistoryScreen /></AccountScreen>} />
  </Routes>
</MemoryRouter>)
