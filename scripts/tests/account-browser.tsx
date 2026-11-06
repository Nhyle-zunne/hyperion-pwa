import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import TopLoadingIndicator from '../../src/components/TopLoadingIndicator'
import { beginPageLoading } from '../../src/lib/pageLoading'
import AdminPaymentsScreen from '../../src/screens/AdminPaymentsScreen'
import AdminQuestionBankScreen from '../../src/screens/AdminQuestionBankScreen'
import AdminLicensesScreen from '../../src/screens/AdminLicensesScreen'
import AccountScreen from '../../src/screens/AccountScreen'
import BasketScreen from '../../src/screens/BasketScreen'
import OrdersPaymentHistoryScreen from '../../src/screens/OrdersPaymentHistoryScreen'
import { fixtureCalls } from '../../src/lib/supabase'
import '../../src/index.css'

Object.assign(window, { accountFixtureCalls: fixtureCalls, beginFixtureLoading: beginPageLoading })
document.documentElement.dataset.theme = 'light'
const section = new URLSearchParams(location.search).get('section')
const initialPath = section === 'account' ? '/account?tab=payments' : section === 'admin' ? '/admin/licenses' : section === 'basket' ? '/BASKET' : section === 'orders' ? '/orders' : section === 'payment' ? '/checkout?payment=success&order_id=fixture-order' : '/checkout?buy_product=gmdss&buy_term=month'
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[initialPath]}>
  <TopLoadingIndicator />
  <div className="route-transition">
  <Routes>
    <Route path="/admin/payments" element={<AdminPaymentsScreen />} />
    <Route path="/admin/questions" element={<AdminQuestionBankScreen />} />
    <Route path="/admin/licenses" element={<AdminLicensesScreen />} />
    <Route path="/account" element={<AccountScreen key="account" />} />
    <Route path="/checkout" element={<AccountScreen key="checkout"><BasketScreen /></AccountScreen>} />
    <Route path="/basket" element={<AccountScreen key="basket"><BasketScreen /></AccountScreen>} />
    <Route path="/orders" element={<AccountScreen key="orders"><OrdersPaymentHistoryScreen /></AccountScreen>} />
  </Routes>
  </div>
</MemoryRouter>)
