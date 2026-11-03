import React from 'react'
import {createRoot} from 'react-dom/client'
import {MemoryRouter} from 'react-router-dom'
import AdminQuestionBankScreen from '../../src/screens/AdminQuestionBankScreen'
import '../../src/index.css'
createRoot(document.getElementById('root')!).render(<MemoryRouter><AdminQuestionBankScreen /></MemoryRouter>)
