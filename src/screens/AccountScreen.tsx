import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = { id: string; product_code: string; amount_php: number; status: string; payment_reference: string | null; created_at: string; admin_note: string | null }
type OwnedTrack = { product_code: string; expires_at: string | null }
export default function AccountScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [product, setProduct] = useState('oic_nw')
  const paymentMethod = 'QR Ph (MariBank / InstaPay)'
  const [reference, setReference] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [note, setNote] = useState('')
  const [instructions, setInstructions] = useState('Payment instructions are being configured. Please check back later.')
  const facebookPage = 'https://www.facebook.com/hyperionbynhyle'
  const qrPhImage = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAggAAAINCAAAAAB+WtgMAAAu3ElEQVR42u19eWCV1bXv+nJORiADIRBCgAQhzBAQEKhAFKrUCbFKn/K02GKt1JartmpvpaK9Xr3qdWgdKt4nFqkVi30V0SriI2FSmQQEmUIYEiAmgQxA5pzv/XGy1w7ZK5vvBOi9JL/fPyzW2vP3O+fbZ2XtvRyXAIAoDEsAgAgAiACACACIAIAIAIgAgAgAiACACEDocBtxXhpb4proZxaLZuP+c+hsmWuDTxVLZNXXQiMzhar3W7vdYVaoFYqNFhp+ja3zWHePUHe9UDdKGWOt034H3wgAXg0AiACACACIAIAIAIgAgAgAiAD8NxEh2Q0Vv/DYV7mqUCkYxwkNvySUW8DWBY6JAm8jmcyNTBUaSWHrbVxjJetmmBVi2HiYK2xk6w2s+wmX87N1iDDvcVwjnctVK1UFq/pb5zg3tIeIbwQArwYARABABABEAEAEAEQAQATAK/wWapzaZKvZO11JDpkSCbq1MYaxbJKSemWbVavYevCQ2dywk2aNSJYalFDHDRcJnZ2YZDaia3Rhaz7rhiQpKUcJ9cJkO41UUgpXTcmwLdnOYiWNjFXSuN7G6BrW2lZb+mDnHbY9x1Edg/8aMYvas7jFSqGHBc+ix5hFjXQutk6wzmHrI6xb4NFT5jObG8zGT1lnj1lczLorWadjFjvzp0nwLOqYxfdZdxfrHmPdy6ybzrr1tomVcbEMa8yi9iw+ZH2OX8GzCGCPAIAIAIgAgAgAiACACIAIQGm2fR8Ughr55FDXbYpViLHc1Wkk+oobGlQklZuosGoxi7QimBmxvIunw+kFsgzDGTm+toDrmex8nOQTrJukLuLDbbXIFK1pVY12KNGkAtV03iqvGZ5/7B/u/wLEYLxdZZO3vc6kUcpZ+m22o8I3S72Fqjs7cVvv5CnYbezRUmwrMIYI8AgAgAiACACACIAIAIAIgA/PNgehbtfkKv5RZykKE+SMrxWVXzhRqPKmHXu0oafY2SdGThB5u5YSEC8DmO9uMuKp/2thLrBd3f9inph+yWfKWIp2FrLuUuJemzqpfyHPXwNrJqBns5e9qWW0+2CzeX5vGZ2XCBPIsTWLeHdZ1szenT0EtZN0fwsM1m6zLBs6hRp4zF5+UDo09DD/JWYbTVKfmYUOM9a42Q71mEZxHAHgEAEQAQAQARABABABEAEAG4QLB5Frs/aqs5QaihcSefGk0UrELDPYXmpIZv6KGkLexjvO5aJT13suWJiRh6k836N871sWiNkrSD6sFoS9Ue1m4nCSswUCj3YqmSqm2LQtYlmxJlq5Hc+K/Fsxj6PYtLrOXYsxhtLWb3LGpcx+U2sE4vv0fP4kxrF7dZ65a4FxxpZq+hexZxzyKAPQIAIgAgAgAiACACIAIAJwXmE64E7ND7WNLwWdjln8eaKlaumLSur5YyVJnsVVfKfhDSNt5WwTo6Q5Ssp7y7SuX6Gkq8eZDd+hYxaLTSsvWdx9SjryupL636qkzR8oadIVSvqQgxZ/wK7F/5OvpFns6HvM7PX4H5SUNsu0fhHic7xAuaGtMYtSbmh7zKJ0z2LInkX7PYv6NPSz1gwuOmaxxMwNncrF9KfD62loHbM4lnV5rT8NjVcDACIAIAIAIgAgAgAiACACIAFwjsgFt1PlobzJL2cN3OkX0nTaMkTeKhbMpS0mTW6bPFTz6gpBf5ZsQj5sS6cNUibq5UGPsP+ChtX2FQD8Qr6aD5IQrnLqKEquu521FcLs26AtIVlisamk+MenFzPDi6ctW5EiHr/BJMeyo32IyS1IWHspMdy5OF4Q1h6VdCzqF6c2Y7cmwj7tnTNtBtQo0AWRZPVz3O3WZkeVuLgKCbYFaNFppLau1zxKsBABEAEAEAEQAQAQARABABABEAr7AdGs6dbequedDUvbTU1G0X2vtQ5YbW6XqbZEbOMitcxm6ydOskXqswdVcFDFVXbm7zL5X0aZat4V0sPTfCtN5x2lJVSFzdZLaL3lDSdTyod3+vpG+EGlPVceiOy4XV/oWpu/leJS14W0kPT215wJYDstI9i7Osp6HtKDer7rdWmHMO54g95ob2ipWtz+Ci4TU3tEaet3sWs4Wq0j2LC3EaGsAeAQARABABABEAEAEAEQAQATh32DyL0iHjj7NM3TVCnNxcdi2+laqkGdVGMa0Z/JLZiI5Z/PHttkncwx7AvyYpqcFW4VIe8af/blrn3KKkJ1baPjDL6gxV8Qyz2PgnlLSF53NIWGQtvcwHbbubn9gK4QmUC6NbulVJeax76s1WEUE6IV1YaOqmC0OLY2kMZ9y54aSls1ihkSYxi1Y2b+KYxRrW+WxMSODOCgRrH7by0XYKCOW+Y6ryhWKJ3NzeHNsia2nEOLOcHkCOt4/4kSOmbs8evBoA7BEAEAEQAQAQARABABABGAc4cRs3TUWnyWx8Qd0vV6ri1UbZxgfcnjHDZ4i17jdCw0WbDar9fT2GGGqvlZdZiLjb7wiTt2C6Ob4bHhq7kGUgIDeDUAIAIAIgAgAgAiACACIAIALQKlgSd2SyH+oj1mnPog72e+F8+NDWcXM3CZ7Fx611+YZEym/9AJ4RVmCxUM6auEND8iy+JpSzH4LVqLSNPTvkx/4PHIIF8GoAQAQARABABABEAEAEAEQAWgvh7OMkJaRkK0kHeX3LugCXq2Hd4KQQu6/+QkkF3FwyN1fFurSQ2Zxjusg6jFZSKadf6MZ5eHtyZ/v5QOTubLPhITzHCCWE66Xg+TTJ3Murt5d1vXlCOnetrjEi1uw22tsCJLG/q0C4sa5/spLMG+EMz2Ky9Xo9jYetMYse4TUlsBuyZ9Hj9Xozhebut857h20kUszi+0Ij84S62rO4PtRl1HzVMYvPC93iej0AewQARABABABEAEAEAEQAQATgPIA9i+wc68I27erqPFRJhXwvV362kmK4bkm22cNl7BNbW98o+PiIbDRX1Xldu7KO72OjgwfNhocm2tg8ybxVTcr+oT2lPS9RUt9JZrltZWZn68zr9U5y1VRueAdbu/OEwtiakWIut5a+rFJSFuv0uo9RUgJ325WtuXrevZTEjkXafqL50D0l7pjKujeExdQxi7cIVn0auhM//pADCh8RGl7W+phFKXHHA9YaV3K5HbbEHals/FLowmvijvXCaWiOWWRGUoYwzneEbp+0nobGqwEAEQAQAQARABABABEAEAEYAQ4S1xR2m2kirYh3X4gJL2s7Wr4JPbwff1jVdpOjiraZOYRQk9+impj9BwIXfbv4OStuR6mvVhbu5b4Y66/Zx1YVBXcy02FStprJkSOJ7HpNtNZKdpf9al8QAquUYy6/I47USN+TD0R7eKq8ZnKqmbsFC9hBUYZiRRaXVKYCH1iRizyA/zfKcEvo7L6XsWe3ijv75n8S3WPSDELC4WPIsaJbaYRY3rrbO4h8u9x7qxQiuCZ1Fj4rmfRserAcAeAQARABABABEAEAEAEQAQAfAKx23ZtnWEqbuTY9XWrmx1p+G/UVLpi0rKF4LgRl/jbehaeo6Tzc4zKV70qpLS7zCbG3+Vklast3UhDMA3T6kqnlPSkf9S0vXLzKo5q7zN7MUyJVUpd2xFnFlhUratuZVrlXRjZsulWu1ZlHAOMYvrQqaTFLOoUWfL4KIx0zofncFlpWAVMri4Qsyi5Fk8LzGLGnbP4kNcDqehAewRABABABEAEAEAEQAQAQARgPMAW8xi90dNnTPf1tpOlmb1VlKit4H05M52veuthnR6+L5YLxNr6lnk+WjPosb3Oc5u7RrTyieV663j3CMsWQ5LHxYpadgwJa34REll5hzjeKGOv2QugIQpHCOaybrFRnBniKFtb3gkWI5Q1+Np6KUeuwj5NLSUG1qKWbSfhpY+TVbPold4jFl0hdzQoccs4jQ0gD0CACIAIAIAIgAgAgAiACAC0GqwA26+Ejo9YCuvfViXTzatf/3GVvfXNUZnCXNtXWhcMVFJH2wxy2npuVjbALSnlAewXSimYxY1Dtjarefm4u4zrRm3KmnzclsrS3gsnEGG5sYrKdoc+3FhAXb+1Wx4yuVK+vtWJY01nFaWDC52z+LD1pjFHFsj+jh5ukfPos4NPZt19phFAYM93rN4f+s/V6nWmMXXQm4vz1yeMqHYRI/3LP6QdcgNDWCPAIAIAIgAgAgAiACACACIALQa7Fnk47mRQqkNDyqpUKDQS+wCmjFHScOFVq5VjqQI7kzKeDxJOCmcnaWkaWzlrDL0WoWnuXbwuCbaT/eI4D2986CSlqnYu4YpSlXA40zlce5l3SjWLVrobSi3RhkqnZmm5yIlHeYuhgqLt5KtwqWSNLsxetFThNtHQgOh54Y+LxlcFrjnAV49i4uFupyFW9+zWCs0J+WGljK4nAMyrLmhpdPQGtqzOByvBgB7BABEAEAEAEQAQAQARABABCA0sGcxSwld2E+Yy2FhOpHw99jHuI5rXMPerKWv2PpaGtEo1HPVlLdtFd5/XkmTuQudBeU3fCPfa/0tjZRPU1I6u/Mu5eY+FfKPaM/iE68r6fkRpnWaWjy/4M6LFZqTpH/h4f12TYjPTjeSyQP4hpf25nvNGg9NVdLip/gpNyMCH9TWiaRP5phNdeOOPmfrdNa9kmMb+DK1OJVcLN060wIuNznLtG5nq9XDXMfFSliXwM0VCDV0/OauXeZHQVuZiH7r3aOuVeqnP4Ghfoh1I3HcyLc820yhxgAu91QOXg0A9ggAiACACACIAIAIAIgAgAhAa2E5BKsTd0y1Bn5JoWoTLtR4F1hTAmv4bI1I1+tpPNv6xB2Hz2Fm9uv1GLHWZxH6IViEqgF4NQAgAgAiACACACIAIAIAIgAgAnC+iTCCvU//EKxPOgp99M14rPs31vXzNpBxgpvsJY+TGMPdFnir8BlX+Jg7eybktTuuqlZyc72EYvaUwF7BiTsOc2c6UjOHdX8TOitjaxbrpuIbARDhb7tTc0Mr/stfmro//xmvBgB7BABEAEAEQAABABABEAgQg6UpH9UCOE8gvZWsE18lgnpA+hvbYQu/1Chfe4uXutQ/9AaC+VrfXuP28Rwz3GLC7gmdVzjXvY+n22PsfWNLORODbusXb2AjcXzzVmsXUqW99E4g4ArwYARABKBl+Nv07AJ5RS4RdesDvrdvItR/8lk9EU2dHYEn3a6J4FafrCeiKjzndk4EInKdc6rtuhTmtE8iRE5SUoZQvjtbw7OVFDPJLHcwYOqyWOKqx1jleNy/7uW6QxOVtKWixc7ckANUmrxYKk5VV592M0K47iyKl+KkkLo4ha1hPIuOrNvJt759xbmTa4T1yTa71YmNi9lazQ3XCzVS2dpRc7510BcUviBYpdPQ5WZKYI1x1pTAEuwpgetc13Wrn508KWvSpGdrWjXDkoW/mjNrxg8/b1VlKSWwFLP4MuumW2dbaUsJLGGux8QdjWjbr4awbpfUE1FS677cT275mshNCmCPcNHDN2W0S0TxvlbvEbBZbBvfCMnJ+D0AIpwHOCBCm0Dg2HGXiBJTwogaSgqJKCzdX5p7oNwfn9yjWweffs5uTdnRwyXV/k5dunXvFOFziHY0HDvpkkN1hzsQUXxvIiK3tqqs8NvjlU58j95J0W3qd2Ub9ywuW1lPRFfPjiCqXrGUiCJ/diw7r46IIroMnjCcr1BvOLJ6TX6lQ0RhscmDRwyNpcCj9Q1Vjus6FYt9RDThl0SBk99u3XbwRDURkT951JR+ESDCxeJNqqyoJzfoWXSrKogo7K3DdUREVHv02M4rpiU18mD/nzdUB98DgbKyPRvvupwqjjvBnWLwx24VEZV+kJOv0m/WFxzZd/MEH4hwMb3nm279G3L5ve8eXXLqzjgiIvf4O+saiNzGPUGg/DRREbnBPYLLFUpXH2xKsp0VyQPaNBHYD9XpUiWd2G4WO8DSfsFzVc7SmGijL+ndWsGNFLPT6+g+JaX1VtLeY2Yro4Rkv6vDsuRfgE06r/+0540+ImpYt76BiHxJcc7p41UuRXYgKnHc5uPsFH7m//PffTCq2ZJF8c14sTwLnbr4mA4uY2sl19XpJEbwK+vLaiWtUe+hWq5atcH2ZAu4YR0/1z/ZtI7q2AIRjl2hpMyveDzX2Lr8wx9s1rcyPP0638nd3sRjfJmDFn80T0l3/ZfZyqsSwxtciXcOUeLQXv6irQVERJWfju5FRLUf1RBR4vSBsWE1Jds+PxoRQxToTzWF1USuv1snIkohougYIopLjvOdPnLcdYhoS+4QIiKq47Gn5itpgPDp+OBuJc1j65xfmeVeHqekdP4OupoZxp+xPdYvpPfeM3UPz1LS1E+U9FVmu3g1uK5zRuIUJ+LyG3tFUv3RpZ8FiOjol6lhRIfziCjijqsiHKLAyKlrd0QTjexHBa/vIaLY20YRURQR+eOiJoxJjYt26ko+/ICI6PSmIdgjXCwbhKY8IIfCJt0fRUTU77bSTURu5TffjSfaGyCi6JFRRES+Dn3Ty/1EMTFUFeE6RGEJ3RprR0z7aeNXa5fOxzYTufV7GtrMdrG9he6EdYsMUqL7yAgiaigpp8a/8dXlK8b4Osc2+ULRLxb/CH7Fxgb/znXqJL4RLtJfDYzw1PgiIqqsIKIEIqLKd6J7dgo/q4/IDdRVVVVWVbnkENVVgwgXExP0DqHJV0N8ByKiukoi6h9bQUTbn8lMS+2RFOWIvzCCCFSVHCz4trT0ZDACIhAAES6a3WJLhqgIIqKGOiLqNnE5kUtHj0Ymde8zbHiHFhur3bZtX0FJDTnkkhN0MoAIF+U3Q5MHFxZG5JDrEpH/+vztLpHr1BQUbFs3+JrBPplIhcvXlFS20b9EtXkimH4hYQfZZ87SL04Gn3lNfuHe6VeLf0XIe3NzZeN2MipQ1eaJIAUPJrI3q5CdY72sWVy3sttjw1HDWGMdUgk7W6p0MCTrClm1o5NZN4ulSQ3Se74FTvgzfnVozcbcOiJyqP7Aoo5Zjlnj0CtbXCKiiH4TMjt//WS9HpvL4+zGypObldSFnQ06ZjHdOiJr/KZkjMu0LWhevs26qawFIujvQr0TGsPPYeGPlHTbk7bmJ3Ki49tD5eZq9tPN4W7nXWGW+1ehbj4fh/4stE7D+14yPe+LrUeqXCIqWTu4q8neVTtcIgof+P3RUQ5FN9l6XuGvMxvcxSO+fpmSrrvO2x5GegRW4/Bs29we/g+b9a72t0dovuzuGT8snfgRw75d91lePZG7r8AkQvHXNUSub+Dd/X22Lxc4lP6HPvmm6arOtp3w97jx9hQiouLSxj9BN6lbVkhEFDMuw8dNgwgXvUuh8T+NbsMG/mqPGJoaRi5VV5sPub6GiJyI5Db6Hdr2ieA4Z31TFP+1QL1v6xrOpIrbpB3XJao74RIR1Ra71obx8/F/4lfAWb/CC97ZcNllPcOJqHrToQA5FBNjPuSIGCKi0+sy08KofOWyBmpbwe7twY9wVhSd3L53eWq/1JhTu7YUuQ5RcqLT+I2hCRGXfIhcJ7D9dwMTyvcePU1t7CuhPfzRqaXfavyXxULXrao6uiH44B3XCRvd19xSJI365qRDVHfgoGrKbUtEaPN7hDOeltPcuxRkxvEzghYobPAVMYKn4TujI/jP0k5EW/Mz8zfCfF6eR1liXb+Z5sdLSx9/oaRbBofYffxcJeW/YfssS8t+q3BaO9bmOHBb2iz2Ti+s1G+CxAE39pXGmvwDd+OpYLWofl3Xavfoo3qhmoCXsb9gzFmlpK6PmtYVHEdW5m1RtLSTbzgcO9Ws+/eDSspl3d3JZxKBz+cmc3ToVyOVNHWmuZha+sfvlTQoVCIk8BKuf8Pm/pFe9Ldef9bmfYPqGohoYBgR+ft+l4h8lyhbxzE9iCihKxHd1H9HftmpqtqAEx4TmzhwdOOh2Y6juhFRJ3UqPizjroydxacpslNC2riwqFoiJzmGiGh+nfCnidHWyNIcXu6X55jWcV/QWX/ptCDt4IbnCkR4/31T99PMdrBH8GWNJyKK8BFR5LhLiYgi1aeny80NRBQWRUT+4UNPl5+qrA04ETGxnTnqOuGmBiJy+P9Oyozioko3qlNCQljd3S4R+WKwWbw49onR0aJMROTr2HRb0En4C9YZJYIaPlQbHg6HEtAW0caPvO3YXd/8Qx3dMT6+cxyefPt6NYRtOmTuM52ouF6ZGUkR+DZsN0SgvkMLzUBjt6qqcGvqyDEpfgcEaCd7hMjxLVyZUpv34Ts76vD828s3AvUaV1AvGjp02FnpH4KvBIMI7ODSv6O6s06n9ZW8Wd9LUJLdn/RwpKFKsFbYOJ+HyUP5gO8v/Mtms8b9zV2L/ss35oq7h26TD2xZmpJ4XhYxnEdX8byt3OYPyFju0axasktJU68267KjqIIX5bjwLIZww2OFAUzLNHXJzYgwXygi6CRv1tSp3tbr17EhLvDGjUp6nE9DH9FEEGrMNrpInFIgHkeKHnDpkBUrbzk/r0ZeqHw7EfhpznvctC75v0paP860/ke1QQnpqQy2fhZvnNV+/QjOqP4tzDx+9M+7rD+Fl0L72CMQdZg5XlLHxjr+zleWbEjuG+6Q21B/qqjoxMk6f6euqV0j/A4RVRc1rlCXJn9JCBxvep7BFxPvgAgXzVdCSmdJ7YsiIkoYtDsynU4d37nxAH/1Jo+/rHskUfnTxcFtzOxL9dMufy5PtxCfeU0CvhEuGriHV0n0SL48jgLHDzRkJFfnr910oomp8O9fXj+qoxM/YgUREZ3eNlRvcncXcAPxAycNa0Mv1nYQoVT4qUSEQSPiTu/6/Mjs5KMb1h450xY48m75lI7hI4MbiNq8b3uqr4SGz2t5rzl6VCxC1doCar7esqWwS03g64/LDduJj2MvD08dsImIiL7dm6JWqeSbxlUbNHJYsq9NLUc7IYIZXlj2Sd7ROnLrwi7pUmH+OaL046FJscO+riEiOr1nRKO7wd3SeENKn5k92tqfodsFEdxOUaUNzVSFxXUuEfnC+nx38Ski8nfq0T265vChxvPO+TuzwvskHyIiCuw/khDcDFSqJAzje7W5n902IuTOFl64LL39ua3d7dJ72VQdu1VJvYQt3fsvKOkNPtM6TSh3z25TN7khWz1z34D/tXV5MyJQQ0Pjbwf/xNyVFDkwa2gHhyjwzZ+CVykFNmWFde+bHyAiOrYvI3if4p7GY8UJY87gQVY470J68uiOZpljGsXWNNa98Hcl7bQtFK1QE6i81jRuy7I9i7xzJcLJHFvNw4dD/mCaqiruYpwwF700Bw8qaaZQrqPQWU5w4dyGU3Wzx3TM61YrDql7LJHv5j3drhwcfNRhg2/8U3DLkOc60RlbjxMRBXaM7ukQUa26/vKy+DO7arKIPLoNwuJlCGPfm+NpoYhT4pQLxvIcvBrORr7cb4ckEX1nuHzOJSKeiBLu7cJUcgZ0Dq50aYPfl9Y1eMDtYH6Kn8g9vD/496sOY31tb6HaPBEquzXURlDdKZEITpw/+EXt1tXW1QeIiBoav5cDdX5KSs+rISKq3DPCT9SwszRo6p9CIMLFBt/w4tyyUV03fyK+GhJ+GrxarehIYenpmuBB2CLlTSCKGbAp+L9t18QQle4NbiTDR8aACBchE5J2/mnDhLyd1WccZGyUp8URkXs4O7+4olYIW3AyUksCRERF25IpkBvcOlKvfn4Q4aJEybo9vlpqTgIiyrghmqh+w8cHaluoGTdsVxURUSD7u2GVe4J+6LAhXdpiOEu7COAMFB0LnHnw0XGIqPvM3g4FNvx1b22Lq5PZ+PvgUC6dyA1GtsVd0hbfDO3xXEMjIXx9fjLOR27BJ0fVPtIJCwsLO3NBkhtvRGv4NFDU+PemXiltcs3a3d8aGl8MHbqMuqaXn6h+16GgPjy2Y3yEQ+Tuahqr4ly+Jug72LJ/ezASIXpAF2pvRPD6Kvz5TUp6LFtJLw5T0u38l9trzZ/f1dbOpnPc1cJFtnKvcW7oOSytaOFz6/jCo2I6JQ4Z09tPRHTqUPBUc8TwKQOiiIgCj+5tWjw9I+gjrf5of1DRudHL2BR6n1l8i5L0ve3jn1CS/tm5iI/8cpIaepx9RtZwszh2TxYINxde8VslLX3ZtD71ppKeHhMCEbzeDHNJlpJeYV3mRCXpE4drKcTOUnjlPrOW41Pb9L/5L8oTjZn1HOkjcsLCo+M6d0tVT7OmPPhToNvUQUHm1J15tWHk2F11RET1m4OE8fXq5Vg+TdWCiy8xy9QdFMoNzvK23Fxsj2BMYutWwbqHq5xov6+GsH53R5lfKQ2NG8WE2MZvkGPNohiHdA1yq/E6hA6DO7bR5WlPm0THcZrfe+Q0vq5ON16od2pDM19+/KAzincfGAYitEVENN7Jf+yr0gBRoHjl6mbB7+HDmu4JwgZ0a6ML0d5zQ3dI9tcTEVW+//Ww1EDBV/nN/1wdlp7W5I/csaPDQYQ28KPRRFR6QjBYuWHfPrlEx+H7NDkG9GyzW6h2QQO3xSsRnX4jzrxIhZr/xo3M0OfiwiZGgQhtFLETB55xFVZ0/2ZLEtYtjTWJGQQiXNS/Fyy2PtePaPJ+7DhhUvPCsX34a2BUhza7Rn7DTaGRwj6sDQ8p6XsPKunt15X0Ep/enMF3xb3BHq6nOnsaiL7MZs0803pQPziWfrNOSa/1P4fNj69/bPftBUF3QnivUeMLjR8W6YmNEa2dLpMZpT2LOmZx9z3miJc/q6RDEiVZuneHZbwdlytJCvPUeSZuzrTNeliL6yW4ujKZHPrAXzfW6djVXD54Poetv+UMLgtC/TotyrFv+xS2c7kK6eGomTm9ggGyTnoLAWa+HtePPbT36OmGyK79+3WPabg+2AX/PHBSU44E3Y2Depx1x80LECOM+KjHmW223bOoz3tHZ9maS03Fr4YzP2jpjSvia2muTocOqaNr6gK+6Ei/4yRPpzOJQFHRwQ9rdPN9JX4+XlRE8J91jg6Fh/Pb36e/OBqKYzqGkXuiOPj7MbWvH0Roj3CPLIm8umt49efBHUr4kAQHRGiPqNm6t2JXRucTO08TEVGXATEEIrRDBPK/qKATvG8L65faln9r49LJFl8Mp7844yxX7JB4AhHaIxH2rm96D2NY3yF+EKFdEuGMv0c7aTcmtOnpMsuFELCveJM8la0LhY3zC3ND7LTS6qm9KeTkaTr+TqcE9jecYw4235iodw+ruDWn/0+7t0yZOmFRRnP3y9h6F+se5+sQpcQd4popH0Z5yD9dnnzY1E3lJDFfZWKzaEf4iK4rt1XUNji+iM7jp0a38dmCCJbXZs87CvceqgiL79m/a5t/hYII1tdDjx5um0sHDiK0Cu3l2m78agBABKBdvBqWNlfEXmUWOrzBW2MTOeJjBUc/3BABIlwMuKW5YrAQ+LP6dm+NrZyspPu+UVJJYhtaLbwagCDcRrAi2TXxEVtnCdZfsHUJ6/hkL+0xK5wWxjGOrforfY7Qmb77cZlg1bFkdUpVLHQ2Waj6DFufdW0YJHytslH/mWq0Gyqmc931rEtjXaVSlVkf5wyuak0hQv9o3ju+EQC8GgAQAQARABABABEAEAEAEQAQAQgNFlcXJ9+lqR6dY7cIHWjPYifbOMYJzb3E1scF63Vs3WDzLHrFMx4XbIdZVV/hmyo0/D5b72KdkNaX3mOrTuucxzrhho4MNmYLzc1l60OCVXsWh+MbAcCrAQARABABABEAEAEAEQAQAQgNHLyarYTIcUpyBLoU8sXEvdOVlMupOaSwMN3KBBWiFuAr16IuU9IQoWrqJCWlCdZhnBsjl2PfasyJ6ZlJ6DbQ1F0i3Ee2rcxci3Xq2Ly+oreWO4sdaS7AMbYetC7UpZFKihYeAS9KL1YlTDKb6yt00T9ZSeadh5aYRcmzyJlH6GEhZlGCNWYx3T0fGCV0a41Z1JjpMWbxSrZqz6L1AsnRgmfRjvesc2TPYmzIy6M9iwsFKzyLAPYIAIgAgAgAiACACACIAIAIQIhgBxz7pmKzlZQr0EXyNvYT/Fpby80aa1WCi3qukCIMqYRPr/foZ1r3HlXSUD6VrhOr5JgTCx152aYujYe8iz1UY5VjzF1tVjjJjRRy1WOcbbh3mpL28Xx2soNqZKzlE9sgjC4+09QV8OPz8wDKhLoq4anhaToqLI3dsyhBOg3NMYvR1qr/hNPQGjM9xiyuFE5Dl5gxixKu56qvsW4e6+4Raqy3eRYlTBQq6NPQT7Luh3g1ANgjACACACIAIAIAIgAgAgAiAOcO0wEn3UKdO5+tnHHCmW+Wu2Wwp06r5tusu6xDcaxWjceZ4jziolfNYtv1UB41rX/72uzsZ0VKeknF9wWE/lPuUlJ/6ziv5Stdl+z2Nm8e53E+JHxIWlAud7lgnGmENHryLGroexb/XbAu8eZZ9Ipz8SwyEtn4tbWzB4TmbmPrSsHqMWbRtXoW7fcsWmMWd1vnM1doRHsWcc8igD0CACIAIAIAIgAgAgAiACAC0GqYnsVOj9rKa3/iWtZN5SPNdsfir9VZ5TrBGZX6YyXteldJG+cL5Xh4do/dPKY4N1IkFBt6ExnlNLQLahEf4P5ZEq8FW4Ul63EOD0U3/GKpkjhTdQWP0xG63cmBfl9wuSnsWrwxja1fNK8Z4snaN4Rxv+AxZjHkDC4SFliHd8FiFjWE09B+j4sXumcxzTaSDKGRd4RyTwrlrsarAcAeAQARABABABEAEAEAEQAQAWgt2LM431aq30wljWBv1trPlPQxu7/sMYtP8i2IkvOSB+BYXZuXepwYxyxWCsb0O5Q0zNrITUOVtOiAkl5hz2KVEup57HH3KenI62Zzm1nKEZZ7GI+lJ+uscZnHuZG0WUoawov3xSdKWllt1h3LyUH++G3wX+OeRQlSBpdziFmUTkOv06t/DjcuenTsTvaYwWWxcM+iFTqDy5chfyalexbTvFW1n4aWgAwuAPYIAIgAgAgAiACACACIAIAIQKvBnsVVSjjxfSX1W6Ck/VlKuuZBJc0cZ7amHYuOTarKMqv24gGw547efz7U6bwS66lYgqD7gZD+Y5Awizd7K2lahbF4UUKF8U8oafl/KumOO83O3v09z4L7fYe9l1eYFXouUlK8MJ+bM5W04C9KemiqkhY/pSR1HaPlNHQm6z5i3SyPLr6QT0Pbc0N7Rb57gWDN4CLFLGrP4vXn9zS0RsY5ZHBBzCKAPQIAIgAgAgAiACACACIAIALQarBnMUsJtQJJLmPXWXfWvb3AbG0+t6Ida7dzfmPO5aw9cRoFWaZOd7uQnWi/vNY2nTns7MtWQvk0W4Xv/kZJS/gWxp/doqQnPlXSrHlKevxbJf05ylio4lvMya7nmR0jc3k0fseplV/9tZLeSTYeRoflSooRGsmeb+qm8DIOEGq83njjoiVmMdPqr/IasyjAHrPY5LGy9RHW/RNOQz9rvWdRyOCicdjj52+edRYcWEp5oeaGDv009Fe4ZxHAHgEAEQAQAQARABABABEAEAEIDbYUyrlZtpoTBfegFLP4VqqSrlUHk3XMYsrbZoWJjylpE5c7KDT8G8EHpWMWr1JpVWJ4nAd+FOqH4xFOw5LJujf5ckDOTa3dsvGrvHWxmmvcN802ACEVdwVX7bXIrHolD2Dpy0pa8LFZbjtLszuelQincmxzGWelifZUjslQko913HC6UKELN7wzx9bwdsG6mFk3pUE9Lm6ui8cPh87MM3CgaR1tqup4JKlZHonANWZYB+AKOq6aIVRN4gFsZd2BA7ahbMarAcAeAQARABABABEAEAEQAQAQgRnkLVPjovXZWbiTvSz8v1evocs/UQrM7Hoq/Xe4t1D7T+EKxGqsdDsBLeE0LVNCqVsczjas+1zgeHYAG8GgAQAQARABABABEAEAEAEQAQAThPRBCu19vqKPzeo4vvFmtfcaq5Dh4H97LjDZsu1OrM5C7+H+uGsG6vuQD51uZ+wuUes5b7XFjaaG8jnqFzfliXjNO74BAsgFcDACIAIAIAIgAgAgAiACECrMs4+Rk8xSPbOV1L2/ac0tUFJXoe6GKkv31dzwTtaVsC7X4yRGciaISMHKzekjgKWs28W6/GyzahFLw+NN60a+Xm+i2dluVumDrMf2KOmgMM6dHPo2MrbVH91i6+L159v6tpc2t3nyGNoTd/D9gE2u19Pod+HZvME29uLz0sVKoWUhcYd0vZ7XmEWN9bb5lJ3DLBbiej0AewQARABABABEAEAEAEQAQATg3OH3VCqRPYbCNWPUj61dWbe1TEnDUowKgTVKirrM1u3RfaYug1OH7DiuJO27+7xGSVlKCOfRnRZC2roOtA1gF7sWt/tM61h1mDeczJGQoNNS7zQl7Ttq1viKZzHWTACr51O1QUlxmbZZ5HEA3e5sJZ0wSl2gFLpSSmDXdhra9ZgSWCfuuI51G2yJO6TT0BozrQO4zfrx8Ji4w54S+B5rF3m20Wkv9kSPKYElwLMIYI8AgAgAiACACACIAIAIAIgAhAj2LGafj9YGJylJcqcxYtg5pr2OFVvMcjrsLq23kk7xQE8IXYwrNiam0YG7Ld1uWvP3K6lvqtmwFLMYQcbi6bi4TiOVNJRsi+JYF/TLQ0rKMjsrEBop5tjP1L5mczpmUaNj47+WexZDxxJvnkXXY0pgjce53GzBuiFUvyenfG5FSmABtcKYRgvlQvcsaljvWZwopASeK3gWF7Y8B7waAOwRABABABEAEAEAEQAQAQARAK8wHXAdHwi1jY+/NHV3cqaLRFvV0hdZfNRWTp+ytkcFPlehpPlKqHzarJAnNDKeBzBeaHjRGrPGQ+rKu3CuWvG8WWzPX5S0mXU5PLyNrJthDZ+M9rYAQ3goYz0+vT8WBv81PIvJIccn2k9DW8FuXRrnsYbdsyjELNpPQ1+wmEXtWXzf4xN5z9sClAlVvcYsSp7F4Xg1ANgjACACACIAIAIAIgAgAgAiAKHB9CxqL1XhH201J0w2a0j4Ax9anm8aE7Q/UbCOuUZJq3KUlMo1/rJXSa9/qKQKy8QoaY6S8jgT8Pb5trHrY7N3pCvpFfZQPW0m09D9H9EN84g3L1fSxCvMzrYLgZT/Em95PhqHrLNYK+gWczxoo2PR5lncYn3AD4d8z2J5qDGLc9j6COuk09ASBM/iYCFm0St0zOKgUKvaT0NrTBfq5l34exbxagBABABEAEAEAEQAQAQARABABCBE2DyLdo+hvdxCPsZ7XLDOV0LCXFsXG7ncatZ9cERJ7Fiku8yrHOnfWGLHnr4Fso81QHLF595m+6DHNL08i80eH8qP+Tj2ItdoJI7Hfvwlb81NvlxJB7kVfdD87sYT0hfIszhBqFFuu2dx3TmwWToNzRdkJoYcg3m/0IXkWSzx1pwUs2j3LOoMLmmsq7Tds2jHk1zjh4IV9ywC2CMAIAIAIgAgAgAiACACACIAIcJvoYbjkUL26wPfYjcZZzyOWaUk7Zsbssrs4v0XlPSj221DebHA1K1Q46vMMo2X/qepW/KqkvTJ3Ec4LjNTmNk0c/G6LTEb1hWu44Pmq3lQ901T0u/YMTeYa7zDibWnmXf4JfGSbRcctN+/V0krubMbZynpwY1nJUKAJfvdi1I5SRqTYdYVnk2soNOJw9OybEP5lZCjZ6KaWUmOF/oT5QvlBgjd6pkJztBUslXozs2t5s5mkPn4NXSmo+9VG8aMLNtHNpWtH3Nns1jXGa8GAHsEAEQAQAQARABABABEAEAEoLWweRb7rbLV5Jwqoj/x92VK+tcSJX0UY2lu58+UNOkxJU1nH0t2lpJ+da2Nze9yCpmrlMOrjo1pC5WUIAzgB6OU9Oq7ZsMPcLzhY12UNK3CMpLdP1WSDtpczrPI4qXV7rbfrrYt93IzOfUJbi6dm8vmxVu6VUnSrZJPP6wklejlgt+zGPJp6JsEq3QaWoMfIeWbMYsag0OOWVzMOr4/lHawrrPZRSobv7R+/ryehtao9JYb+h1rI8jgAmCPAIAIAIgAgAgAiACMC54f8DSH6McHyko3YAAAAASUVORK5CYII='
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [owned, setOwned] = useState<OwnedTrack[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!supabase) return
    void supabase.from('payment_settings').select('instructions').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.instructions) setInstructions(data.instructions) })
  }, [])
  const refreshAccount = async () => {
    if (!supabase || !session?.user.id) { setOwned([]); setOrders([]); return }
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements').select('product_code,expires_at').eq('user_id', session.user.id).eq('status', 'active').gt('expires_at', new Date().toISOString()),
      supabase.from('orders').select('id,product_code,amount_php,status,payment_reference,created_at,admin_note').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
    ])
    if (entitlements.error) setMessage(entitlements.error.message)
    else setOwned((entitlements.data ?? []) as OwnedTrack[])
    if (orderResult.error) setMessage(orderResult.error.message)
    else setOrders((orderResult.data ?? []) as Order[])
    await refreshCloudEntitlements()
  }
  useEffect(() => { void refreshAccount() }, [session?.user.id])
  const submitAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'signup' && !result.data.session) setMessage('Account created. Check your email to confirm your address, then sign in.')
    else setMessage(mode === 'signup' ? 'Account created.' : 'Signed in successfully.')
  }
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session) return
    setBusy(true); setMessage('Submitting your payment for manual review…')
    try {
      const { data, error } = await supabase.functions.invoke('submit-manual-payment', { body: { productCode: product, paymentMethod, paymentReference: reference, proofUrl, customerNote: note } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage(`Payment details submitted. Your reference is ${data.order.id}. Please send your payment screenshot to our Facebook page. Access will be enabled after manual verification.`)
      setReference(''); setProofUrl(''); setNote('')
      await refreshAccount()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to submit payment. Please try again.') }
    finally { setBusy(false) }
  }
  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem', borderRadius: 10 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const statusLabel: Record<string,string> = { submitted: 'Awaiting manual review', pending: 'Awaiting payment review', paid: 'Approved', failed: 'Rejected', refunded: 'Refunded' }

  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Back</button>
    <h1 className="page-title">Hyperion Account</h1>
    <p className="subtitle">Create an account to subscribe to individual review tracks for 12 months.</p>
    {!supabaseConfigured && <div style={{ ...card, borderColor: 'var(--danger)' }}><strong>Supabase is not configured yet.</strong><p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Cloudflare Pages environment variables.</p></div>}
    {params.get('payment') === 'success' && <div style={card}>Payments are verified manually. A return to this page does not grant access.</div>}
    {message && <div role="status" style={{ ...card, lineHeight: 1.5 }}>{message}</div>}
    {!session ? <section style={card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button type="button" className={mode === 'signup' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signup')} style={{ flex: 1 }}>Create account</button>
        <button type="button" className={mode === 'signin' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signin')} style={{ flex: 1 }}>Sign in</button>
      </div>
      <form onSubmit={submitAuth}>
        <label>Email address<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={field} /></label>
        <label style={{ display: 'block', marginTop: '1rem' }}>Password<input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} style={field} /></label>
        <button type="submit" className="btn btn-primary" disabled={!supabaseConfigured || busy} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Please wait…' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}</button>
      </form>
    </section> : <>
      <section style={card}>
        <div style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>SIGNED IN AS</div><strong style={{ overflowWrap: 'anywhere' }}>{session.user.email}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '.8rem' }}>
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>Admin dashboard</button>
          <button type="button" className="btn btn-outline" onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }}>Sign out</button>
        </div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Your purchased access</h2>
        {owned.length ? owned.map(item => <div key={item.product_code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code} · expires {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>) : <p style={{ color: 'var(--text-muted)' }}>No approved purchases are linked to this account yet.</p>}
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Manual payment instructions</h2>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{instructions}</div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Submit payment details</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', lineHeight: 1.5 }}>Each payment covers one individual track for 12 months. Send the exact amount shown for the reviewer track you selected. Incorrect or short payments may delay approval. Access starts only after manual verification.</p>
        <form onSubmit={submitPayment}>
          <label style={label}>Choose an individual track (12-month subscription)<select value={product} onChange={e => setProduct(e.target.value)} style={field}>{PAID_PRODUCTS.map(item => <option key={item.code} value={item.code}>{item.label} · ₱{item.annualPrice}/year</option>)}</select></label>
          <div style={{ ...card, textAlign: 'center', marginTop: '.9rem', background: '#fff', color: '#172033' }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '.25rem' }}>QR Ph · MariBank / InstaPay</div>
            <p style={{ margin: '0 0 .75rem', color: '#4b5563', fontSize: '.9rem' }}>Scan this QR code using your bank or e-wallet app.</p>
            <img src={qrPhImage} alt="MariBank InstaPay QR Ph payment code" style={{ display: 'block', width: 'min(100%, 340px)', height: 'auto', margin: '0 auto', imageRendering: 'pixelated' }} />
            <p style={{ margin: '.75rem 0 0', color: '#4b5563', fontSize: '.85rem' }}>Account name and bank details are shown on the QR code. Verify the recipient in your payment app before sending.</p>
          </div>
          <div style={{ padding: '.85rem', border: '1px solid var(--border)', borderRadius: 8, marginTop: '.75rem', lineHeight: 1.5 }}>
            <strong>Amount to send: ₱{PAID_PRODUCTS.find(item => item.code === product)?.annualPrice ?? 0}</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.25rem' }}>Send the exact amount for {PAID_PRODUCTS.find(item => item.code === product)?.label ?? product} only. This payment covers one reviewer track for 12 months. Please double-check the selected track and amount before confirming your transfer.</div>
          </div>
          <label style={label}>Payment method<input value="QR Ph (MariBank / InstaPay)" readOnly style={field} /></label>
          <label style={label}>Transaction/reference number<input required maxLength={160} value={reference} onChange={e => setReference(e.target.value)} style={field} /></label>
          <div style={label}>
            <label htmlFor="proof-of-payment">Proof of payment screenshot link <span style={{ color: 'var(--danger)' }}>(required)</span></label>
            <input id="proof-of-payment" type="url" required placeholder="Paste a publicly accessible image link, if available" value={proofUrl} onChange={e => setProofUrl(e.target.value)} style={field} />
            <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.5 }}>After sending the payment, send your screenshot to our Facebook page using the button below. Proof must be provided before your subscription can be approved.</p>
            <a href={facebookPage} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '.5rem' }}>SEND PROOF TO OUR FACEBOOK PAGE</a>
          </div>
          <label style={label}>Additional notes (optional)<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} style={field} /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Submitting…' : 'SUBMIT FOR REVIEW'}</button>
        </form>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Payment submissions</h2>
        <button type="button" className="btn btn-outline" onClick={() => void refreshAccount()}>Refresh status</button>
        {orders.length ? orders.map(order => <div key={order.id} style={{ padding: '.8rem 0', borderBottom: '1px solid var(--border)' }}>
          <strong>{PAID_PRODUCTS.find(p => p.code === order.product_code)?.label ?? order.product_code} · ₱{order.amount_php}</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginTop: 4 }}>{statusLabel[order.status] || order.status} · {new Date(order.created_at).toLocaleString()}</div>
          <div style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>Reference: {order.payment_reference || 'Not provided'} · Order: {order.id}</div>
          {order.admin_note && <p style={{ marginBottom: 0 }}>Admin note: {order.admin_note}</p>}
        </div>) : <p style={{ color: 'var(--text-muted)' }}>No payment submissions yet.</p>}
      </section>
    </>}
  </div>
}
