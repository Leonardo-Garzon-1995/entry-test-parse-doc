const URL = "https://docs.google.com/document/d/e/2PACX-1vSZ9d7OCd4QMsjJi2VFQmPYLebG2sGqI879_bSPugwOo_fgRcZLAFyfajPWU91UDiLg-RxRD41lVYRA/pub"

async function fetchDoc(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Fetch fail ${res.status} ${res.statusText}` )
    
    const text = await res.text()

    return text

}

const result = await fetchDoc(URL)
console.log(result)
